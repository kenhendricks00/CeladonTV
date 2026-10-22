const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const emotes = require(path.join(__dirname, '../../main/assets/scripts/celadontv-emotes.js'));
const {
    parseBttvGlobal, parseBttvChannel, parseFfzGlobal, parseFfzChannel, parseSeventvGlobal, parseSeventvChannel,
    buildLookup, tokenize, plan, decorateLine, createEmoteStore, channelFromUsherUrl, STORAGE_KEY,
} = emotes;

// ---- Fixtures shaped like the providers' real responses ---------------------------------

const BTTV_GLOBAL = [
    { id: 'b1', code: 'catJAM', imageType: 'gif', animated: true, modifier: false },
    { id: 'b2', code: 'cvHazmat', imageType: 'png', animated: false, modifier: false },
    { id: 'b3', code: 'h!', imageType: 'png', animated: false, modifier: true },
];
const BTTV_CHANNEL = { channelEmotes: [{ id: 'b4', code: 'OMEGALUL', animated: false }], sharedEmotes: [{ id: 'b5', code: 'Clap', animated: true }] };
const ffz = (id, name, extra = {}) => ({ id, name, width: 28, height: 28, urls: { 1: `https://cdn.frankerfacez.com/emote/${id}/1`, 2: `https://cdn.frankerfacez.com/emote/${id}/2` }, modifier: false, modifier_flags: 0, ...extra });
const FFZ_GLOBAL = { default_sets: [3], sets: { 3: { emoticons: [ffz(9, 'ZreknarF'), ffz(10, 'ffzRainbow', { modifier: true, modifier_flags: 2049 }), ffz(11, 'ffzHat', { modifier: true, modifier_flags: 0 })] }, 99: { emoticons: [ffz(12, 'NotDefault')] } } };
const FFZ_CHANNEL = { room: { set: 500, id: 'somechannel' }, sets: { 500: { emoticons: [ffz(20, 'WideHard', { width: 84, height: 28, animated: { 1: 'https://cdn.frankerfacez.com/emote/20/animated/1', 2: 'https://cdn.frankerfacez.com/emote/20/animated/2' } })] } } };
const seventv = (id, name, { flags = 0, dataFlags = 0, width = 32, height = 32 } = {}) => ({
    id, name, flags,
    data: { flags: dataFlags, animated: false, host: { url: `//cdn.7tv.app/emote/${id}`, files: [
        { name: '1x.webp', width, height, format: 'WEBP' }, { name: '2x.webp', width: width * 2, height: height * 2, format: 'WEBP' },
        { name: '1x.avif', width, height, format: 'AVIF' },
    ] } },
});
const SEVENTV_GLOBAL = { emotes: [seventv('s1', 'EZ'), seventv('s2', 'RainTime', { flags: 1, dataFlags: 256 })] };
const SEVENTV_CHANNEL = { emote_set: { emotes: [seventv('s3', 'Aware'), seventv('s4', 'WideAware', { width: 96, height: 32 }), seventv('s5', 'PETPET', { flags: 1 }), seventv('s6', 'catJAM')] } };

test('reads each provider\'s emotes, skipping effect-only modifiers and flagging overlays', () => {
    assert.deepEqual(parseBttvGlobal(BTTV_GLOBAL).map((e) => [e.code, e.zeroWidth]), [['catJAM', false], ['cvHazmat', true]]);
    assert.equal(parseBttvGlobal(BTTV_GLOBAL)[0].url, 'https://cdn.betterttv.net/emote/b1/2x.webp', 'animated WebP');
    assert.deepEqual(parseBttvChannel(BTTV_CHANNEL).map((e) => e.code), ['OMEGALUL', 'Clap']);
    assert.deepEqual(parseFfzGlobal(FFZ_GLOBAL).map((e) => [e.code, e.zeroWidth]), [['ZreknarF', false], ['ffzHat', true]], 'only default sets; hidden effect modifiers skipped');
    const wide = parseFfzChannel(FFZ_CHANNEL)[0];
    assert.equal(wide.url, 'https://cdn.frankerfacez.com/emote/20/animated/2', 'animated version preferred');
    assert.deepEqual([wide.width, wide.height], [84, 28]);
    const s7 = parseSeventvGlobal(SEVENTV_GLOBAL);
    assert.equal(s7[0].url, 'https://cdn.7tv.app/emote/s1/2x.webp');
    assert.deepEqual(s7.map((e) => e.zeroWidth), [false, true]);
    assert.deepEqual(parseSeventvChannel(SEVENTV_CHANNEL).map((e) => [e.code, e.zeroWidth, e.width]), [['Aware', false, 32], ['WideAware', false, 96], ['PETPET', true, 32], ['catJAM', false, 32]]);
});

test('broken or unexpected responses give no emotes instead of throwing', () => {
    for (const bad of [null, undefined, 'oops', 42, {}, { sets: null }, { emote_set: null }, [null, {}]]) {
        for (const parse of [parseBttvGlobal, parseBttvChannel, parseFfzGlobal, parseFfzChannel, parseSeventvGlobal, parseSeventvChannel]) {
            assert.deepEqual(parse(bad), [], `${parse.name}(${JSON.stringify(bad)})`);
        }
    }
});

test('channel emotes win over global ones, and 7TV over BetterTTV over FrankerFaceZ', () => {
    const lookup = buildLookup({
        seventv: { global: parseSeventvGlobal(SEVENTV_GLOBAL), channel: parseSeventvChannel(SEVENTV_CHANNEL) },
        bttv: { global: parseBttvGlobal(BTTV_GLOBAL), channel: parseBttvChannel(BTTV_CHANNEL) },
        ffz: { global: parseFfzGlobal(FFZ_GLOBAL), channel: [] },
    });
    assert.match(lookup.get('catJAM').url, /7tv/, 'the channel\'s 7TV catJAM over BetterTTV\'s global one');
    assert.match(lookup.get('OMEGALUL').url, /betterttv/);
    assert.match(lookup.get('ZreknarF').url, /frankerfacez/);
    assert.equal(lookup.get('h!'), undefined);
});

// ---- Messages ---------------------------------------------------------------------------

const LOOKUP = buildLookup({
    seventv: { global: parseSeventvGlobal(SEVENTV_GLOBAL), channel: parseSeventvChannel(SEVENTV_CHANNEL) },
    bttv: { global: parseBttvGlobal(BTTV_GLOBAL), channel: parseBttvChannel(BTTV_CHANNEL) },
    ffz: { global: parseFfzGlobal(FFZ_GLOBAL), channel: parseFfzChannel(FFZ_CHANNEL) },
});
const describe = (pieces) => pieces.map((p) => (p.text !== undefined ? JSON.stringify(p.text) : `[${[p.emote, ...p.overlays].map((e) => e.code).join('+')}]`)).join(' ');

test('splits a message into words and keeps its spacing', () => {
    assert.deepEqual(tokenize('hi  Aware\tok'), ['hi', '  ', 'Aware', '\t', 'ok']);
    assert.deepEqual(tokenize(''), []);
});

test('replaces whole words that name an emote, case-sensitively, and nothing else', () => {
    assert.equal(describe(plan('u Aware', LOOKUP)), '"u " [Aware]');
    assert.equal(describe(plan('aware AWARE Aware, Aware!', LOOKUP)), '"aware AWARE Aware, Aware!"', 'not other cases or with punctuation attached');
    assert.equal(describe(plan('OMEGALUL OMEGALUL', LOOKUP)), '[OMEGALUL] " " [OMEGALUL]');
    assert.equal(describe(plan('no emotes here', LOOKUP)), '"no emotes here"');
});

test('stacks zero-width emotes on the emote before them', () => {
    assert.equal(describe(plan('Aware PETPET lol', LOOKUP)), '[Aware+PETPET] " lol"', '7TV zero-width');
    assert.equal(describe(plan('OMEGALUL cvHazmat RainTime', LOOKUP)), '[OMEGALUL+cvHazmat+RainTime]', 'BetterTTV overlay, then another');
    assert.equal(describe(plan('EZ ffzHat', LOOKUP)), '[EZ+ffzHat]', 'FrankerFaceZ visible modifier');
    assert.equal(describe(plan('PETPET alone', LOOKUP)), '[PETPET] " alone"', 'nothing to stack on: shown on its own');
    assert.equal(describe(plan('hi PETPET', LOOKUP)), '"hi " [PETPET]', 'a word before is not an emote');
});

// A minimal DOM: enough of Node/Element/Text for the decorator.
class FakeText {
    constructor(text) { this.nodeType = 3; this.nodeValue = text; this.parentNode = null; }
    get textContent() { return this.nodeValue; }
}
class FakeElement {
    constructor(tag, attrs = {}) {
        this.nodeType = 1; this.tagName = tag.toUpperCase(); this.childNodes = []; this.parentNode = null;
        this.attributes = { ...attrs }; this.style = {}; this.className = '';
    }
    get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
    get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
    get nextSibling() { const s = this.parentNode.childNodes; return s[s.indexOf(this) + 1] || null; }
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node; }
    insertBefore(node, ref) {
        node.parentNode = this;
        const i = ref ? this.childNodes.indexOf(ref) : -1;
        if (i < 0) this.childNodes.push(node); else this.childNodes.splice(i, 0, node);
        return node;
    }
}
Object.defineProperty(FakeText.prototype, 'nextSibling', { get() { const s = this.parentNode.childNodes; return s[s.indexOf(this) + 1] || null; } });
const doc = { createElement: (tag) => new FakeElement(tag), createTextNode: (text) => new FakeText(text) };
const span = (text) => { const s = new FakeElement('span'); s.appendChild(new FakeText(text)); return s; };

// A chat line as Twitch's TV app renders it: badge, sender, message spans, and one of
// Twitch's own emotes (a div holding an img).
function chatLine(...parts) {
    const line = new FakeElement('div', { dir: 'auto' });
    const badge = line.appendChild(new FakeElement('div'));
    badge.appendChild(new FakeElement('img', { alt: 'Subscriber' }));
    line.appendChild(span('viewer: '));
    for (const p of parts) line.appendChild(p);
    return line;
}

test('shows emote images in chat lines, sized from the emote, keeping Twitch\'s own text node', () => {
    const message = span('u Aware WideAware PETPET');
    const original = message.childNodes[0];
    const native = new FakeElement('div', { 'aria-label': 'Kappa' });
    native.appendChild(new FakeElement('img', { alt: 'Kappa', src: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0' }));
    const line = chatLine(message, native, span(' OMEGALUL'));
    assert.equal(decorateLine(doc, line, LOOKUP), 3);
    assert.equal(message.childNodes[0], original, 'the text node React knows stays first');
    assert.equal(original.nodeValue, 'u ');
    const boxes = message.childNodes.filter((n) => n.nodeType === 1);
    assert.equal(boxes.length, 2, 'Aware, then WideAware with PETPET on top');
    assert.match(boxes[0].style.cssText, /height:2\.4rem;width:calc\(2\.4rem \* 1\.000\)/, 'square, at Twitch\'s emote height');
    assert.match(boxes[1].style.cssText, /width:calc\(2\.4rem \* 3\.000\)/, 'wide emote keeps its aspect');
    assert.equal(boxes[1].children.length, 2, 'the zero-width emote is a second image in the same box');
    assert.match(boxes[1].children[1].style.cssText, /position:absolute/);
    assert.equal(boxes[1].children[0].getAttribute('alt'), 'WideAware');
    assert.equal(native.children[0].getAttribute('alt'), 'Kappa', 'Twitch\'s own emote untouched');
    assert.equal(line.childNodes[1].textContent, 'viewer: ', 'the sender is never treated as message text');
});

test('leaves mentions, links and other elements in a message alone', () => {
    const mention = new FakeElement('span');
    const bold = mention.appendChild(new FakeElement('b'));
    bold.appendChild(new FakeText('@Aware'));
    const link = new FakeElement('a', { href: 'https://example.com/Aware' });
    link.appendChild(new FakeText('Aware'));
    const line = chatLine(mention, link, span(' Aware'));
    assert.equal(decorateLine(doc, line, LOOKUP), 1, 'only the plain text span');
    assert.equal(link.textContent, 'Aware');
    assert.equal(bold.textContent, '@Aware');
});

test('lines without a sender are not chat messages', () => {
    const notice = new FakeElement('div', { dir: 'auto' });
    notice.appendChild(span('Welcome to the chat room! Aware'));
    assert.equal(decorateLine(doc, notice, LOOKUP), 0);
    assert.equal(notice.textContent, 'Welcome to the chat room! Aware');
});

// ---- Fetching and caching ---------------------------------------------------------------

function fakeStorage(initial = {}) {
    const data = { ...initial };
    return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

const RESPONSES = {
    'https://7tv.io/v3/emote-sets/global': SEVENTV_GLOBAL,
    'https://7tv.io/v3/users/twitch/123': SEVENTV_CHANNEL,
    'https://api.betterttv.net/3/cached/emotes/global': BTTV_GLOBAL,
    'https://api.betterttv.net/3/cached/users/twitch/123': BTTV_CHANNEL,
    'https://api.frankerfacez.com/v1/set/global': FFZ_GLOBAL,
    'https://api.frankerfacez.com/v1/room/id/123': FFZ_CHANNEL,
};

function network({ down = [] } = {}) {
    const calls = [];
    return {
        calls,
        fetchJson: async (url) => {
            calls.push(url);
            if (down.some((d) => url.includes(d))) throw new Error('unreachable');
            if (!(url in RESPONSES)) throw new Error('404 ' + url);
            return JSON.parse(JSON.stringify(RESPONSES[url]));
        },
    };
}

const ALL = { bttv: true, ffz: true, seventv: true };

test('fetches each enabled provider once and serves the channel from its cache until it expires', async () => {
    let clock = 0;
    const net = network();
    const store = createEmoteStore({ fetchJson: net.fetchJson, storage: fakeStorage(), now: () => clock });
    const lookup = await store.lookupFor('123', ALL);
    assert.equal(net.calls.length, 6);
    for (const code of ['Aware', 'OMEGALUL', 'WideHard', 'EZ', 'catJAM', 'ZreknarF']) assert.ok(lookup.has(code), code);
    clock += 20 * 60000;
    await store.lookupFor('123', ALL);
    assert.equal(net.calls.length, 6, 'no requests within 30 minutes');
    clock += 11 * 60000;
    await store.lookupFor('123', ALL);
    assert.deepEqual(net.calls.slice(6).sort(), ['https://7tv.io/v3/users/twitch/123', 'https://api.betterttv.net/3/cached/users/twitch/123', 'https://api.frankerfacez.com/v1/room/id/123'].sort(), 'channel sets refreshed after 30 minutes, global ones kept for 6 hours');
});

test('a provider that is turned off is never asked', async () => {
    const net = network();
    const store = createEmoteStore({ fetchJson: net.fetchJson, storage: fakeStorage(), now: () => 0 });
    const lookup = await store.lookupFor('123', { bttv: true, ffz: false, seventv: false });
    assert.ok(net.calls.every((u) => u.includes('betterttv')));
    assert.ok(lookup.has('OMEGALUL') && !lookup.has('Aware') && !lookup.has('WideHard'));
});

test('a provider that is down leaves its words as text, keeps old emotes, and is not hammered', async () => {
    let clock = 0;
    const storage = fakeStorage();
    // Seen before, 2 hours ago: the 7TV channel set is in the cache, expired.
    const first = createEmoteStore({ fetchJson: network().fetchJson, storage, now: () => clock });
    await first.lookupFor('123', ALL);
    clock += 2 * 3600000;
    const net = network({ down: ['7tv.io', 'frankerfacez'] });
    const store = createEmoteStore({ fetchJson: net.fetchJson, storage, now: () => clock });
    const lookup = await store.lookupFor('123', ALL);
    assert.ok(lookup.has('Aware'), 'the expired 7TV set is still used while 7TV is down');
    assert.ok(lookup.has('OMEGALUL'), 'BetterTTV unaffected');
    assert.ok(lookup.has('WideHard'), 'FrankerFaceZ\'s expired channel set kept too');
    const asked = net.calls.length;
    clock += 60000;
    await store.lookupFor('123', ALL);
    assert.equal(net.calls.filter((u) => u.includes('7tv')).length, net.calls.slice(0, asked).filter((u) => u.includes('7tv')).length, 'no retry within 5 minutes');
    clock += 5 * 60000;
    await store.lookupFor('123', ALL);
    assert.ok(net.calls.filter((u) => u.includes('7tv')).length > 1, 'retried after 5 minutes');

    // Never seen and everything down: no emotes, no error.
    const offline = createEmoteStore({ fetchJson: network({ down: ['7tv', 'betterttv', 'frankerfacez'] }).fetchJson, storage: fakeStorage(), now: () => 0 });
    assert.equal((await offline.lookupFor('123', ALL)).size, 0);
});

test('the cache survives a reload and keeps only the 8 most recent channels', async () => {
    let clock = 0;
    const storage = fakeStorage();
    const fetchJson = async (url) => {
        const id = (url.match(/(\d+)$/) || [])[1];
        if (url.includes('7tv.io/v3/users')) return { emote_set: { emotes: [seventv('x' + id, 'Chan' + id)] } };
        if (url.includes('7tv.io/v3/emote-sets/global')) return SEVENTV_GLOBAL;
        throw new Error('off');
    };
    const store = createEmoteStore({ fetchJson, storage, now: () => clock });
    for (let id = 1; id <= 10; id++) {
        clock += 1000;
        await store.lookupFor(String(id), { seventv: true });
    }
    const saved = JSON.parse(storage.data[STORAGE_KEY]);
    assert.deepEqual(Object.keys(saved.channels).sort((a, b) => a - b), ['3', '4', '5', '6', '7', '8', '9', '10']);
    const calls = [];
    const reloaded = createEmoteStore({ fetchJson: async (u) => { calls.push(u); throw new Error('offline'); }, storage, now: () => clock });
    assert.ok((await reloaded.lookupFor('10', { seventv: true })).has('Chan10'), 'served from storage after a reload');
    assert.equal(calls.length, 0);
});

test('finds the channel being watched from the player\'s playback request', () => {
    const token = encodeURIComponent(JSON.stringify({ channel: 'xqc', channel_id: 71092938, adblock: false }));
    assert.deepEqual(channelFromUsherUrl(`https://usher.ttvnw.net/api/channel/hls/xqc.m3u8?player_type=pulsar&token=${token}&sig=abc`), { id: '71092938', login: 'xqc' });
    assert.deepEqual(channelFromUsherUrl(`https://usher.ttvnw.net/api/v2/channel/hls/xqc.m3u8?token=${token}`), { id: '71092938', login: 'xqc' });
    assert.equal(channelFromUsherUrl('https://usher.ttvnw.net/vod/123.m3u8?token=%7B%7D'), null, 'not a VOD');
    assert.equal(channelFromUsherUrl('https://usher.ttvnw.net/api/channel/hls/x.m3u8?token=notjson'), null);
    assert.equal(channelFromUsherUrl('https://example.com/api/channel/hls/x.m3u8'), null);
});
