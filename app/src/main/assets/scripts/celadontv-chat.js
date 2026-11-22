// CeladonTV chat: earlier messages when you open a channel, and chat filters.
//
// Twitch's TV app reads chat as plain IRC over a WebSocket to irc-ws.chat.twitch.tv. This
// script sits on that socket (settings come in as window.__ctvChat):
//   - Earlier messages: when the app joins a channel, the channel's recent messages are
//     fetched from the public recent-messages service (recent-messages.robotty.de) and handed
//     to the app as if they had just arrived, before any live ones, so chat isn't empty.
//   - Filters: chat messages from known bots, chat commands ("!uptime"), messages with a
//     hidden word, and messages from hidden users are dropped before the app sees them.
// Everything else on the socket passes through untouched. If the service is down or slow,
// chat simply starts empty, as it does without CeladonTV.
(function () {
    'use strict';

    const CHAT_SOCKET = /^wss:\/\/irc-ws(-r)?\.chat\.twitch\.tv(:\d+)?\/?$/;
    const HISTORY_LIMIT = 50;
    const HISTORY_TIMEOUT_MS = 4000;
    const MAX_HELD_LINES = 500;
    const MAX_SEEN_IDS = 2000;
    // Twitch's chat history commands that make sense to replay (chat lines, subs, raids...).
    const HISTORY_COMMANDS = new Set(['PRIVMSG', 'USERNOTICE']);
    // Live lines for a joining channel that wait behind its history so the order stays right.
    const HELD_COMMANDS = new Set(['PRIVMSG', 'USERNOTICE', 'CLEARMSG', 'CLEARCHAT', 'NOTICE']);
    // Widely used chat bots, by login.
    const KNOWN_BOTS = new Set([
        'nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'wizebot', 'botisimo',
        'deepbot', 'coebot', 'phantombot', 'ankhbot', 'vivbot', 'sery_bot', 'botrixoficial',
        'soundalerts', 'kofistreambot', 'own3d', 'streamstickers', 'pretzelrocks', 'commanderroot',
        'blerp', 'tangiabot', 'lumiastream', 'creatisbot', 'frostytoolsdotcom', 'streamraiders',
        'pokemoncommunitygame', 'songlistbot', 'buttsbot', 'supibot', 'thepositivebot', 'stay_hydrated_bot',
    ]);

    // ---- IRC lines -----------------------------------------------------------------------

    // One IRC line as { tags, prefix, command, params }; the last param is the message text.
    // Tags keep their raw (escaped) values; a tag with no "=" (as the history service sends
    // them) has the value ''.
    function parseLine(line) {
        let rest = line;
        const tags = {};
        if (rest.startsWith('@')) {
            const space = rest.indexOf(' ');
            if (space < 0) return null;
            for (const pair of rest.slice(1, space).split(';')) {
                if (!pair) continue;
                const eq = pair.indexOf('=');
                if (eq < 0) tags[pair] = '';
                else tags[pair.slice(0, eq)] = pair.slice(eq + 1);
            }
            rest = rest.slice(space + 1);
        }
        let prefix = '';
        if (rest.startsWith(':')) {
            const space = rest.indexOf(' ');
            if (space < 0) return null;
            prefix = rest.slice(1, space);
            rest = rest.slice(space + 1);
        }
        let trailing = null;
        const colon = rest.indexOf(' :');
        if (colon >= 0) {
            trailing = rest.slice(colon + 2);
            rest = rest.slice(0, colon);
        }
        const params = rest.split(' ').filter(Boolean);
        const command = params.shift();
        if (!command) return null;
        if (trailing !== null) params.push(trailing);
        return { tags, prefix, command: command.toUpperCase(), params };
    }

    // The line again, in the strict form Twitch sends (every tag "key=value", the last param
    // after " :"), which is the form Twitch's own chat client is written for.
    function formatLine(msg) {
        const tags = Object.keys(msg.tags);
        const head = (tags.length ? '@' + tags.map((k) => `${k}=${msg.tags[k]}`).join(';') + ' ' : '') +
            (msg.prefix ? ':' + msg.prefix + ' ' : '') + msg.command;
        if (!msg.params.length) return head;
        const middle = msg.params.slice(0, -1);
        return [head, ...middle].join(' ') + ' :' + msg.params[msg.params.length - 1];
    }

    const login = (msg) => msg.prefix.split('!')[0].toLowerCase();
    const channelOf = (msg) => (msg.params[0] && msg.params[0].startsWith('#') ? msg.params[0].toLowerCase() : null);

    // The message text, without the wrapper of "/me" messages.
    function textOf(msg) {
        const text = msg.params[msg.params.length - 1] || '';
        const action = /^\u0001ACTION (.*)\u0001?$/.exec(text);
        return action ? action[1] : text;
    }

    // ---- Filters -------------------------------------------------------------------------

    const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Hidden words and users as typed in settings: case is ignored, users may be written with
    // an "@", and a word only matches on its own (hiding "ass" leaves "class" alone).
    function createFilter(config) {
        const users = new Set((config.users || []).map((u) => String(u).trim().replace(/^@/, '').toLowerCase()).filter(Boolean));
        const words = (config.words || []).map((w) => String(w).trim()).filter(Boolean);
        const wordPattern = words.length ?
            new RegExp(`(?<![\\p{L}\\p{N}_])(?:${words.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`, 'iu') : null;
        const hideBots = !!config.hideBots;
        const hideCommands = !!config.hideCommands;
        if (!users.size && !wordPattern && !hideBots && !hideCommands) return null;

        // Whether a chat message is hidden. Only chat messages are ever hidden; subs, raids
        // and everything else from Twitch always show.
        return function hides(msg) {
            if (msg.command !== 'PRIVMSG') return false;
            const name = login(msg);
            const display = (msg.tags['display-name'] || '').toLowerCase();
            if (users.has(name) || (display && users.has(display))) return true;
            if (hideBots && KNOWN_BOTS.has(name)) return true;
            const text = textOf(msg);
            if (hideCommands && /^\s*!\S/.test(text)) return true;
            return !!(wordPattern && wordPattern.test(text));
        };
    }

    // ---- History -------------------------------------------------------------------------

    function historyUrl(channel) {
        const name = encodeURIComponent(channel.replace(/^#/, ''));
        return `https://recent-messages.robotty.de/api/v2/recent-messages/${name}?limit=${HISTORY_LIMIT}` +
            '&hide_moderation_messages=true&hide_moderated_messages=true';
    }

    // The service's answer as the lines to hand to Twitch's app: the channel's chat lines and
    // notices, oldest first, in Twitch's strict form, each flagged historical.
    function historyLines(json, channel) {
        if (!json || !Array.isArray(json.messages)) return [];
        const out = [];
        for (const raw of json.messages) {
            const msg = typeof raw === 'string' ? parseLine(raw) : null;
            if (!msg || !HISTORY_COMMANDS.has(msg.command) || channelOf(msg) !== channel) continue;
            msg.tags.historical = '1';
            out.push(msg);
        }
        return out;
    }

    // ---- The chat socket -----------------------------------------------------------------

    // The ids of chat lines Twitch's app has been given (live or from history), oldest first,
    // across sockets: when the app reconnects and joins again, history it already has is
    // not shown twice.
    function createSeenIds(max = MAX_SEEN_IDS) {
        const ids = new Set();
        return {
            has: (id) => ids.has(id),
            add(id) {
                if (!id || ids.has(id)) return;
                ids.add(id);
                if (ids.size > max) ids.delete(ids.values().next().value);
            },
        };
    }

    // The part of the script that knows nothing about WebSockets: lines in from the socket,
    // JOINs out, and history results, giving the lines to deliver to Twitch's app.
    //   deliver(lines): hand lines to the app, in order.
    //   fetchHistory(channel): Promise of the service's JSON (or a rejection).
    //   setTimer(fn, ms): returns a cancel function.
    function createChatSession({ config, deliver, fetchHistory, setTimer, seen }) {
        const hides = createFilter(config);
        const joining = new Map(); // channel -> { held, history, joined, cancel }

        function passes(msg) {
            if (hides && hides(msg)) return false;
            if (msg.command === 'PRIVMSG' || msg.command === 'USERNOTICE') {
                const id = msg.tags.id;
                if (id && seen.has(id) && msg.tags.historical === '1') return false;
                seen.add(id);
            }
            return true;
        }

        // A joining channel's history goes out once Twitch has confirmed the join (the app
        // ignores chat for a channel it isn't in) and the history is in, followed by the live
        // lines that came in meanwhile.
        function release(channel, withHistory) {
            const state = joining.get(channel);
            if (!state) return;
            joining.delete(channel);
            state.cancel();
            const live = state.held;
            const liveIds = new Set(live.map((m) => m.tags.id).filter(Boolean));
            const history = withHistory ? (state.history || []).filter((m) => !liveIds.has(m.tags.id)) : [];
            const lines = [...history, ...live].filter(passes).map(formatLine);
            if (lines.length) deliver(lines);
        }

        function onJoinSent(channel) {
            if (!config.history || joining.has(channel)) return;
            const state = { held: [], history: null, joined: false, cancel: () => {} };
            joining.set(channel, state);
            state.cancel = setTimer(() => release(channel, false), HISTORY_TIMEOUT_MS);
            fetchHistory(channel).then(
                (json) => {
                    if (joining.get(channel) !== state) return;
                    state.history = historyLines(json, channel);
                    if (state.joined) release(channel, true);
                },
                () => release(channel, false),
            );
        }

        // A frame Twitch's app sent; JOINs start fetching history.
        function onSend(data) {
            if (typeof data !== 'string') return;
            for (const line of data.split(/\r?\n/)) {
                const join = /^JOIN\s+(\S+)/i.exec(line);
                if (join) for (const channel of join[1].split(',')) if (channel.startsWith('#')) onJoinSent(channel.toLowerCase());
            }
        }

        // A frame from Twitch's chat server: the lines to give the app now.
        function onReceive(data) {
            const out = [];
            const releases = [];
            for (const line of data.split('\r\n')) {
                if (!line) continue;
                const msg = parseLine(line);
                if (!msg) {
                    out.push(line);
                    continue;
                }
                const channel = channelOf(msg);
                const state = channel && joining.get(channel);
                if (state && HELD_COMMANDS.has(msg.command)) {
                    if (state.held.length < MAX_HELD_LINES) state.held.push(msg);
                    continue;
                }
                if (state && (msg.command === 'JOIN' || msg.command === 'ROOMSTATE')) {
                    state.joined = true;
                    if (state.history) releases.push(channel);
                }
                if (msg.command === 'PART' && state) {
                    state.cancel();
                    joining.delete(channel);
                }
                // Unchanged lines go out exactly as Twitch sent them.
                if (passes(msg)) out.push(line);
            }
            return { lines: out, releases };
        }

        return {
            onSend,
            onReceive,
            release,
            close() {
                for (const state of joining.values()) state.cancel();
                joining.clear();
            },
        };
    }

    // Replaces the page's WebSocket with one that is the same in every way, except that
    // sockets to Twitch's chat server run through a chat session. Twitch's app gets message
    // events from the socket as usual; the raw ones from the server are stopped before the
    // app's handlers see them and the session's lines are dispatched in their place.
    function install(win, config) {
        const Native = win.WebSocket;
        if (!Native) return;
        const seen = createSeenIds();
        const ours = new WeakSet();

        function attach(socket) {
            const nativeSend = socket.send;
            function deliver(lines) {
                if (socket.readyState !== Native.OPEN) return;
                const event = new win.MessageEvent('message', { data: lines.map((l) => l + '\r\n').join('') });
                ours.add(event);
                socket.dispatchEvent(event);
            }
            const session = createChatSession({
                config,
                seen,
                deliver,
                setTimer: (fn, ms) => {
                    const id = win.setTimeout(fn, ms);
                    return () => win.clearTimeout(id);
                },
                fetchHistory: (channel) => win.fetch(historyUrl(channel), { credentials: 'omit' })
                    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))),
            });
            // Registered before Twitch's app adds its own handlers, so it runs first.
            socket.addEventListener('message', (event) => {
                if (ours.has(event) || typeof event.data !== 'string') return;
                event.stopImmediatePropagation();
                let result;
                try {
                    result = session.onReceive(event.data);
                } catch (e) {
                    deliver(event.data.split('\r\n').filter(Boolean)); // never lose chat to a bug here
                    return;
                }
                if (result.lines.length) deliver(result.lines);
                for (const channel of result.releases) session.release(channel, true);
            });
            socket.addEventListener('close', () => session.close());
            socket.send = function (data) {
                try {
                    session.onSend(data);
                } catch (e) { /* sending must never fail because of history */ }
                return nativeSend.call(this, data);
            };
        }

        win.WebSocket = new Proxy(Native, {
            construct(target, args, newTarget) {
                const socket = Reflect.construct(target, args, newTarget);
                try {
                    if (CHAT_SOCKET.test(String(args[0]))) attach(socket);
                } catch (e) { /* leave the socket as it is */ }
                return socket;
            },
        });
    }

    if (typeof window !== 'undefined' && window.top === window && !window.__ctvChatInstalled && window.__ctvChat) {
        window.__ctvChatInstalled = true;
        install(window, window.__ctvChat);
    }

    if (typeof module !== 'undefined') {
        module.exports = {
            parseLine,
            formatLine,
            createFilter,
            historyUrl,
            historyLines,
            createSeenIds,
            createChatSession,
            install,
            KNOWN_BOTS,
            HISTORY_TIMEOUT_MS,
        };
    }
})();
