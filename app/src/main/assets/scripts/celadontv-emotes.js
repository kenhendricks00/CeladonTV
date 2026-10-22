// CeladonTV chat emotes: BetterTTV, FrankerFaceZ and 7TV emotes in Twitch's TV chat.
//
// The channel's global and channel emote sets are fetched from each provider's public API
// (only the providers turned on in CeladonTV settings, passed in as window.__ctvEmotes),
// cached per channel, and words in chat messages that name one of them are shown as the
// emote image, the way the browser extensions show them on desktop Twitch. Twitch's own
// emotes, mentions and links are left alone; if a provider is down the words stay text.
(function () {
    'use strict';

    const PROVIDERS = ['seventv', 'bttv', 'ffz'];
    const GLOBAL_TTL_MS = 6 * 3600000;
    const CHANNEL_TTL_MS = 30 * 60000;
    const RETRY_MS = 5 * 60000;
    const FETCH_TIMEOUT_MS = 8000;
    const MAX_CACHED_CHANNELS = 8;
    const STORAGE_KEY = 'celadontv.emotes.v1';
    const EMOTE_HEIGHT = '2.4rem'; // Twitch's own chat emotes on the TV
    const EMOTE_CLASS = 'celadontv-emote';
    // BetterTTV's overlay emotes, drawn on top of the emote before them.
    const BTTV_OVERLAYS = new Set(['cvHazmat', 'cvMask', 'IceCold', 'SoSnowy', 'TopHat', 'SantaHat', 'ReinDeer', 'CandyCane']);

    // ---- Provider data -> emotes: { code, url, width, height, zeroWidth } -----------------
    // width/height are the 1x size in pixels where the provider gives one (for the aspect).

    function bttvEmote(e) {
        if (!e || !e.id || !e.code || e.modifier) return null; // c!, h!, w!...: effects, not images
        return { code: e.code, url: `https://cdn.betterttv.net/emote/${e.id}/2x.webp`, width: null, height: null, zeroWidth: BTTV_OVERLAYS.has(e.code) };
    }

    function parseBttvGlobal(json) {
        return Array.isArray(json) ? json.map(bttvEmote).filter(Boolean) : [];
    }

    function parseBttvChannel(json) {
        if (!json || typeof json !== 'object') return [];
        return [...(json.channelEmotes || []), ...(json.sharedEmotes || [])].map(bttvEmote).filter(Boolean);
    }

    function ffzEmote(e) {
        if (!e || !e.name || !e.urls) return null;
        // Modifiers flagged hidden (bit 0) are effects such as ffzRainbow with no image to show.
        if (e.modifier && e.modifier_flags & 1) return null;
        const urls = e.animated || e.urls;
        const url = urls['2'] || urls['1'] || urls['4'];
        if (!url) return null;
        return { code: e.name, url, width: e.width || null, height: e.height || null, zeroWidth: !!e.modifier };
    }

    function ffzSets(json, ids) {
        if (!json || !json.sets) return [];
        return ids.flatMap((id) => ((json.sets[id] && json.sets[id].emoticons) || []).map(ffzEmote)).filter(Boolean);
    }

    function parseFfzGlobal(json) {
        return ffzSets(json, (json && json.default_sets) || []);
    }

    function parseFfzChannel(json) {
        return json && json.room ? ffzSets(json, [json.room.set]) : [];
    }

    function seventvEmote(e) {
        const data = e && e.data;
        const host = data && data.host;
        if (!e || !e.name || !host || !host.url || !Array.isArray(host.files)) return null;
        const webp = host.files.filter((f) => f.format === 'WEBP');
        const file = webp.find((f) => f.name === '2x.webp') || webp[0];
        if (!file) return null;
        const small = webp.find((f) => f.name === '1x.webp') || file;
        const base = host.url.startsWith('//') ? 'https:' + host.url : host.url;
        // Zero-width: the active-emote flag (bit 0) or the emote's own flag (bit 8).
        return { code: e.name, url: `${base}/${file.name}`, width: small.width || null, height: small.height || null, zeroWidth: !!((e.flags & 1) || (data.flags & 256)) };
    }

    function parseSeventvGlobal(json) {
        return json && Array.isArray(json.emotes) ? json.emotes.map(seventvEmote).filter(Boolean) : [];
    }

    function parseSeventvChannel(json) {
        return json && json.emote_set && Array.isArray(json.emote_set.emotes) ? json.emote_set.emotes.map(seventvEmote).filter(Boolean) : [];
    }

    const SOURCES = {
        seventv: {
            global: { url: () => 'https://7tv.io/v3/emote-sets/global', parse: parseSeventvGlobal },
            channel: { url: (id) => `https://7tv.io/v3/users/twitch/${id}`, parse: parseSeventvChannel },
        },
        bttv: {
            global: { url: () => 'https://api.betterttv.net/3/cached/emotes/global', parse: parseBttvGlobal },
            channel: { url: (id) => `https://api.betterttv.net/3/cached/users/twitch/${id}`, parse: parseBttvChannel },
        },
        ffz: {
            global: { url: () => 'https://api.frankerfacez.com/v1/set/global', parse: parseFfzGlobal },
            channel: { url: (id) => `https://api.frankerfacez.com/v1/room/id/${id}`, parse: parseFfzChannel },
        },
    };

    // Which emote a word names. Channel emotes win over global ones; between providers, 7TV,
    // then BetterTTV, then FrankerFaceZ (the order the desktop extensions stack in).
    function buildLookup(sets) {
        const lookup = new Map();
        for (const scope of ['global', 'channel']) {
            for (const provider of [...PROVIDERS].reverse()) {
                for (const e of (sets[provider] && sets[provider][scope]) || []) lookup.set(e.code, e);
            }
        }
        return lookup;
    }

    // ---- Messages ------------------------------------------------------------------------

    // Words and the whitespace between them, in order.
    function tokenize(text) {
        return text.split(/(\s+)/).filter((t) => t !== '');
    }

    // The pieces a message becomes: runs of text, and emotes with any zero-width emotes that
    // directly follow them stacked on top (the space between is dropped). A zero-width emote
    // with no emote before it is shown on its own.
    function plan(text, lookup) {
        const pieces = [];
        let pendingSpace = '';
        const pushText = (t) => {
            const last = pieces[pieces.length - 1];
            if (last && last.text !== undefined) last.text += t;
            else pieces.push({ text: t });
        };
        for (const token of tokenize(text)) {
            if (/^\s+$/.test(token)) {
                pendingSpace += token;
                continue;
            }
            const emote = lookup.get(token);
            const last = pieces[pieces.length - 1];
            if (emote && emote.zeroWidth && last && last.emote) {
                last.overlays.push(emote);
                pendingSpace = '';
                continue;
            }
            if (pendingSpace) pushText(pendingSpace);
            pendingSpace = '';
            if (emote) pieces.push({ emote, overlays: [] });
            else pushText(token);
        }
        if (pendingSpace) pushText(pendingSpace);
        return pieces;
    }

    // The element for one emote (and its overlays): its size is set up front from the emote's
    // aspect where known, so nothing in chat moves when the image arrives.
    function renderEmote(doc, piece) {
        const box = doc.createElement('span');
        box.className = EMOTE_CLASS;
        const all = [piece.emote, ...piece.overlays];
        const aspect = Math.max(...all.map((e) => (e.width && e.height ? e.width / e.height : 0)));
        box.style.cssText = `display:inline-block;position:relative;vertical-align:middle;height:${EMOTE_HEIGHT};` +
            (aspect ? `width:calc(${EMOTE_HEIGHT} * ${aspect.toFixed(3)});` : '') + 'margin:0 0.1em;';
        all.forEach((e, i) => {
            const img = doc.createElement('img');
            img.setAttribute('alt', e.code);
            img.setAttribute('src', e.url);
            img.setAttribute('decoding', 'async');
            img.style.cssText = i === 0 ?
                'height:100%;' + (aspect ? 'width:100%;object-fit:contain;' : 'width:auto;') :
                'position:absolute;left:50%;top:0;height:100%;transform:translateX(-50%);';
            box.appendChild(img);
        });
        return box;
    }

    // Replaces emote words in one text node in place. The node itself is kept (as the first
    // text piece) so React, which owns it, still finds it. Returns how many emotes were added.
    function decorateText(doc, node, lookup) {
        const pieces = plan(node.nodeValue || '', lookup);
        if (!pieces.some((p) => p.emote)) return 0;
        const parent = node.parentNode;
        const after = node.nextSibling;
        let first = true;
        let count = 0;
        for (const piece of pieces) {
            if (piece.text !== undefined && first) {
                node.nodeValue = piece.text;
                first = false;
                continue;
            }
            if (first) {
                node.nodeValue = '';
                first = false;
            }
            const el = piece.text !== undefined ? doc.createTextNode(piece.text) : renderEmote(doc, piece);
            if (piece.emote) count++;
            parent.insertBefore(el, after);
        }
        return count;
    }

    // A chat line on Twitch's TV app: a text block (div dir="auto") with badges, the sender
    // ("name: ") and the message, which is plain spans of text (Twitch's emotes, mentions and
    // links are other elements and are never touched).
    function messageSpans(line) {
        const children = Array.from(line.children || []);
        const sender = children.findIndex((c) => c.tagName === 'SPAN' && /:\s$/.test(c.textContent || ''));
        if (sender < 0) return null;
        return children.slice(sender + 1).filter((c) => c.tagName === 'SPAN' && Array.from(c.childNodes).every((n) => n.nodeType === 3));
    }

    function decorateLine(doc, line, lookup) {
        const spans = messageSpans(line);
        if (!spans) return 0;
        let count = 0;
        for (const span of spans) {
            for (const node of Array.from(span.childNodes)) if (node.nodeType === 3) count += decorateText(doc, node, lookup);
        }
        return count;
    }

    // ---- Fetching and caching ------------------------------------------------------------

    // Emote sets per provider and scope, kept in memory and in localStorage with their fetch
    // time: global sets for 6 hours, a channel's for 30 minutes, the 8 most recent channels.
    // A failed fetch keeps whatever was cached (even if old) and is not retried for 5 minutes;
    // with nothing cached the provider simply has no emotes, and chat stays text.
    function createEmoteStore({ fetchJson, storage, now = () => Date.now() }) {
        let state = { global: {}, channels: {} };
        try {
            state = JSON.parse(storage.getItem(STORAGE_KEY)) || state;
        } catch (e) { /* no or bad cache */ }
        state.global = state.global || {};
        state.channels = state.channels || {};
        const failedAt = new Map();
        const inFlight = new Map();

        function save() {
            const ids = Object.keys(state.channels).sort((a, b) => (state.channels[b].usedAt || 0) - (state.channels[a].usedAt || 0));
            for (const id of ids.slice(MAX_CACHED_CHANNELS)) delete state.channels[id];
            try {
                storage.setItem(STORAGE_KEY, JSON.stringify(state));
            } catch (e) { /* storage full or unavailable: memory only */ }
        }

        const pack = (emotes) => emotes.map((e) => [e.code, e.url, e.width, e.height, e.zeroWidth ? 1 : 0]);
        const unpack = (rows) => (rows || []).map(([code, url, width, height, zw]) => ({ code, url, width, height, zeroWidth: !!zw }));

        async function load(provider, scope, id) {
            const holder = scope === 'global' ? state.global : (state.channels[id] = state.channels[id] || {});
            const cached = holder[provider];
            const ttl = scope === 'global' ? GLOBAL_TTL_MS : CHANNEL_TTL_MS;
            const key = `${provider}:${scope}:${id || ''}`;
            if (cached && now() - cached.at < ttl) return unpack(cached.emotes);
            if (failedAt.has(key) && now() - failedAt.get(key) < RETRY_MS) return unpack(cached && cached.emotes);
            if (!inFlight.has(key)) {
                const source = SOURCES[provider][scope];
                inFlight.set(key, fetchJson(source.url(id)).then(
                    (json) => {
                        holder[provider] = { at: now(), emotes: pack(source.parse(json)) };
                        failedAt.delete(key);
                        save();
                    },
                    () => failedAt.set(key, now()),
                ).finally(() => inFlight.delete(key)));
            }
            await inFlight.get(key);
            return unpack(holder[provider] && holder[provider].emotes);
        }

        // The lookup for a channel, from the enabled providers.
        async function lookupFor(id, enabled) {
            if (id) {
                state.channels[id] = state.channels[id] || {};
                state.channels[id].usedAt = now();
            }
            const sets = {};
            await Promise.all(PROVIDERS.filter((p) => enabled[p]).map(async (provider) => {
                const [global, channel] = await Promise.all([load(provider, 'global'), id ? load(provider, 'channel', id) : []]);
                sets[provider] = { global, channel };
            }));
            return buildLookup(sets);
        }

        return { lookupFor, state: () => state };
    }

    // The channel being watched, from the player's own playback request: usher's URL names the
    // channel and carries its access token, whose JSON has the channel's Twitch user ID.
    function channelFromUsherUrl(url) {
        if (typeof url !== 'string' || !/usher\.ttvnw\.net\/api\/(v2\/)?channel\/hls\//.test(url)) return null;
        try {
            const token = JSON.parse(new URL(url).searchParams.get('token') || '{}');
            const id = token.channel_id;
            return id ? { id: String(id), login: token.channel || null } : null;
        } catch (e) {
            return null;
        }
    }

    // ---- The page ------------------------------------------------------------------------

    function install(win, enabled) {
        const doc = win.document;
        const store = createEmoteStore({
            storage: win.localStorage,
            fetchJson: (url) => {
                const controller = new win.AbortController();
                const timer = win.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
                return win.fetch(url, { signal: controller.signal, credentials: 'omit' })
                    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
                    .finally(() => win.clearTimeout(timer));
            },
        });
        let lookup = new Map();
        let channel = null;
        let list = null;
        let listObserver = null;
        const pending = new Set();
        let frame = 0;
        // Lines already shown with a given lookup; a WeakMap, so lines Twitch drops are freed.
        const done = new WeakMap();

        function flush() {
            frame = 0;
            for (const line of pending) {
                if (!line.isConnected || done.get(line) === lookup) continue;
                done.set(line, lookup);
                decorateLine(doc, line, lookup);
            }
            pending.clear();
        }

        function queue(line) {
            if (!lookup.size || done.get(line) === lookup) return;
            pending.add(line);
            if (!frame) frame = win.requestAnimationFrame(flush);
        }

        function isLine(el) {
            return el.nodeType === 1 && el.tagName === 'DIV' && el.getAttribute('dir') === 'auto' && messageSpans(el) !== null;
        }

        function collect(node, out) {
            if (node.nodeType !== 1) return;
            if (isLine(node)) out.push(node);
            else for (const el of node.querySelectorAll('div[dir="auto"]')) if (isLine(el)) out.push(el);
        }

        function onMutations(mutations) {
            const lines = [];
            for (const m of mutations) for (const n of m.addedNodes) collect(n, lines);
            if (!list && lines.length) watchList(lines[0]);
            lines.forEach(queue);
        }

        // Until the chat list is found the page is observed; then only the list is.
        const pageObserver = new win.MutationObserver(onMutations);
        function watchPage() {
            pageObserver.observe(doc.body, { childList: true, subtree: true });
        }

        function watchList(line) {
            // Each line sits in a row wrapper inside the list.
            list = line.parentElement && line.parentElement.parentElement;
            if (!list) return;
            pageObserver.disconnect();
            listObserver = new win.MutationObserver(onMutations);
            listObserver.observe(list, { childList: true, subtree: true });
            rescan();
        }

        function rescan() {
            if (!list) return;
            for (const el of list.querySelectorAll('div[dir="auto"]')) if (isLine(el)) queue(el);
        }

        win.setInterval(() => {
            if (list && !list.isConnected) {
                listObserver.disconnect();
                list = null;
                watchPage();
            }
        }, 2000);

        async function onChannel(next) {
            if (channel && channel.id === next.id) return;
            channel = next;
            const loaded = await store.lookupFor(next.id, enabled);
            if (channel !== next) return;
            lookup = loaded;
            rescan();
        }

        if (win.PerformanceObserver) {
            const perf = new win.PerformanceObserver((entries) => {
                for (const entry of entries.getEntries()) {
                    const found = channelFromUsherUrl(entry.name);
                    if (found) onChannel(found);
                }
            });
            perf.observe({ type: 'resource', buffered: true });
        }
        if (doc.body) watchPage();
        else doc.addEventListener('DOMContentLoaded', watchPage);
    }

    if (typeof window !== 'undefined' && window.top === window && !window.__ctvEmotesInstalled && window.__ctvEmotes) {
        window.__ctvEmotesInstalled = true;
        install(window, window.__ctvEmotes);
    }

    if (typeof module !== 'undefined') {
        module.exports = {
            parseBttvGlobal,
            parseBttvChannel,
            parseFfzGlobal,
            parseFfzChannel,
            parseSeventvGlobal,
            parseSeventvChannel,
            buildLookup,
            tokenize,
            plan,
            decorateText,
            decorateLine,
            messageSpans,
            createEmoteStore,
            channelFromUsherUrl,
            STORAGE_KEY,
        };
    }
})();
