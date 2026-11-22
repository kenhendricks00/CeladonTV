const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    parseLine, formatLine, createFilter, historyUrl, historyLines, createSeenIds, createChatSession, install, HISTORY_TIMEOUT_MS,
} = require(path.join(__dirname, '../../main/assets/scripts/celadontv-chat.js'));

// ---- Fixtures shaped like the real traffic ----------------------------------------------

// Twitch's chat server: strict form.
const live = (id, user, text, channel = '#streamer') =>
    `@badge-info=;badges=;color=#8A2BE2;display-name=${user};emotes=;id=${id};room-id=1;tmi-sent-ts=2 ` +
    `:${user.toLowerCase()}!${user.toLowerCase()}@${user.toLowerCase()}.tmi.twitch.tv PRIVMSG ${channel} :${text}`;
// recent-messages.robotty.de: tags without "=" and one-word messages without ":".
const recent = (id, user, text, channel = '#streamer') =>
    `@display-name=${user};badge-info;emotes;historical=1;rm-received-ts=1;id=${id} ` +
    `:${user.toLowerCase()}!${user.toLowerCase()}@${user.toLowerCase()}.tmi.twitch.tv PRIVMSG ${channel} ${/\s/.test(text) ? ':' + text : text}`;
const JOIN_ECHO = ':justinfan1!justinfan1@justinfan1.tmi.twitch.tv JOIN #streamer';
const ROOMSTATE = '@emote-only=0;room-id=1 :tmi.twitch.tv ROOMSTATE #streamer';

const textOf = (line) => parseLine(line).params.slice(-1)[0];

// ---- IRC lines --------------------------------------------------------------------------

test('parses lines in both Twitch\'s strict form and the history service\'s loose one', () => {
    const strict = parseLine(live('a', 'Alice', 'hello there :) friend'));
    assert.equal(strict.command, 'PRIVMSG');
    assert.equal(strict.prefix, 'alice!alice@alice.tmi.twitch.tv');
    assert.deepEqual(strict.params, ['#streamer', 'hello there :) friend']);
    assert.equal(strict.tags['display-name'], 'Alice');
    assert.equal(strict.tags.emotes, '');

    const loose = parseLine(recent('b', 'Bob', 'cool'));
    assert.deepEqual(loose.params, ['#streamer', 'cool']);
    assert.equal(loose.tags['badge-info'], '');
    assert.equal(loose.tags.historical, '1');

    assert.deepEqual(parseLine(':tmi.twitch.tv 001 justinfan1 :Welcome, GLHF!').params, ['justinfan1', 'Welcome, GLHF!']);
    assert.equal(parseLine('PING :tmi.twitch.tv').command, 'PING');
    assert.equal(parseLine('@broken'), null);
});

test('formats lines in the strict form, every tag with a value and the text after " :"', () => {
    const msg = parseLine(recent('b', 'Bob', 'cool'));
    assert.equal(formatLine(msg),
        '@display-name=Bob;badge-info=;emotes=;historical=1;rm-received-ts=1;id=b :bob!bob@bob.tmi.twitch.tv PRIVMSG #streamer :cool');
    const line = live('a', 'Alice', 'hello : there');
    assert.equal(formatLine(parseLine(line)), line, 'a strict line survives unchanged');
});

// ---- Filters ----------------------------------------------------------------------------

test('no filter at all when nothing is set to be hidden', () => {
    assert.equal(createFilter({ history: true, words: [], users: [] }), null);
    assert.equal(createFilter({ words: [' ', ''], users: ['@'] }), null);
});

test('hides messages from hidden users, by login or display name, with or without "@"', () => {
    const hides = createFilter({ users: ['@Alice', ' BOB '] });
    assert.equal(hides(parseLine(live('1', 'Alice', 'hi'))), true);
    assert.equal(hides(parseLine(live('2', 'bob', 'hi'))), true);
    assert.equal(hides(parseLine(live('3', 'Carol', 'hi alice'))), false, 'mentioning a hidden user is fine');
});

test('hides whole hidden words and phrases, ignoring case, and not inside other words', () => {
    const hides = createFilter({ words: ['spoiler', 'game over', 'c++'] });
    const check = (text) => hides(parseLine(live('1', 'Carol', text)));
    assert.equal(check('SPOILER: he dies'), true);
    assert.equal(check('no spoilers please'), false, 'part of a longer word');
    assert.equal(check('it is Game Over man'), true);
    assert.equal(check('i love c++ so much'), true, 'symbols are matched literally');
    assert.equal(check('cxx'), false);
    assert.equal(check('\u0001ACTION drops a spoiler\u0001'), true, '/me messages too');
});

test('hides known bots and chat commands when asked to', () => {
    const hides = createFilter({ hideBots: true, hideCommands: true });
    assert.equal(hides(parseLine(live('1', 'Nightbot', 'Follow on Twitter!'))), true);
    assert.equal(hides(parseLine(live('2', 'StreamElements', 'hi'))), true);
    assert.equal(hides(parseLine(live('3', 'Carol', '!uptime'))), true);
    assert.equal(hides(parseLine(live('4', 'Carol', '! not a command'))), false);
    assert.equal(hides(parseLine(live('5', 'Carol', 'wow!'))), false);
});

test('only chat messages are hidden, never subs, raids or anything else from Twitch', () => {
    const hides = createFilter({ users: ['alice'], hideBots: true });
    const sub = '@display-name=Alice;id=9;msg-id=sub :tmi.twitch.tv USERNOTICE #streamer :thanks!';
    assert.equal(hides(parseLine(sub)), false);
    assert.equal(hides(parseLine(ROOMSTATE)), false);
});

// ---- History ----------------------------------------------------------------------------

test('asks the history service for the channel\'s last messages, without moderated ones', () => {
    const url = new URL(historyUrl('#Some_Streamer'));
    assert.equal(url.origin + url.pathname, 'https://recent-messages.robotty.de/api/v2/recent-messages/Some_Streamer');
    assert.equal(url.searchParams.get('limit'), '50');
    assert.equal(url.searchParams.get('hide_moderated_messages'), 'true');
    assert.equal(url.searchParams.get('hide_moderation_messages'), 'true');
});

test('keeps only the channel\'s chat lines and notices from the history, flagged historical', () => {
    const json = {
        messages: [
            recent('1', 'Alice', 'first'),
            '@historical=1 :tmi.twitch.tv CLEARCHAT #streamer :alice',
            '@historical=1;msg-id=raid;id=2 :tmi.twitch.tv USERNOTICE #streamer',
            recent('3', 'Bob', 'elsewhere', '#other'),
            '@id=4 :carol!carol@carol.tmi.twitch.tv PRIVMSG #streamer :no flag',
            42,
        ],
        error: null,
    };
    const lines = historyLines(json, '#streamer');
    assert.deepEqual(lines.map((m) => [m.command, m.tags.id, m.tags.historical]), [['PRIVMSG', '1', '1'], ['USERNOTICE', '2', '1'], ['PRIVMSG', '4', '1']]);
    assert.deepEqual(historyLines({ error: 'channel not joined', messages: [] }, '#streamer'), []);
    assert.deepEqual(historyLines(null, '#streamer'), []);
});

test('remembers a bounded number of ids, dropping the oldest', () => {
    const seen = createSeenIds(2);
    seen.add('a');
    seen.add('b');
    seen.add('c');
    assert.deepEqual([seen.has('a'), seen.has('b'), seen.has('c')], [false, true, true]);
});

// ---- The session ------------------------------------------------------------------------

function session(config, { history } = {}) {
    const delivered = [];
    const timers = [];
    let answer;
    const s = createChatSession({
        config,
        seen: createSeenIds(),
        deliver: (lines) => delivered.push(...lines),
        fetchHistory: () => new Promise((resolve, reject) => { answer = { resolve, reject }; }),
        setTimer: (fn) => {
            const timer = { fn, cancelled: false };
            timers.push(timer);
            return () => { timer.cancelled = true; };
        },
    });
    // What the socket listener does with a frame from the server.
    const receive = (...lines) => {
        const result = s.onReceive(lines.map((l) => l + '\r\n').join(''));
        delivered.push(...result.lines);
        result.releases.forEach((c) => s.release(c, true));
    };
    const flush = () => new Promise((r) => setImmediate(r));
    return { s, delivered, timers, receive, flush, answer: () => answer, history };
}

test('shows the history after the join, then the live messages that came in meanwhile', async () => {
    const t = session({ history: true });
    t.s.onSend('JOIN #Streamer');
    t.receive(JOIN_ECHO, ROOMSTATE);
    t.receive(live('L1', 'Dan', 'live one'));
    assert.deepEqual(t.delivered, [JOIN_ECHO, ROOMSTATE], 'live chat waits for the history');

    t.answer().resolve({ messages: [recent('H1', 'Alice', 'old one'), recent('H2', 'Bob', 'older two words')] });
    await t.flush();
    assert.deepEqual(t.delivered.slice(2).map(textOf), ['old one', 'older two words', 'live one']);
    assert.match(t.delivered[2], /^@display-name=Alice;badge-info=;/, 'history is in the strict form');

    t.receive(live('L2', 'Dan', 'live two'));
    assert.equal(textOf(t.delivered.at(-1)), 'live two', 'afterwards chat flows straight through');
    assert.ok(t.timers[0].cancelled);
});

test('history that arrives before Twitch confirms the join waits for it', async () => {
    const t = session({ history: true });
    t.s.onSend('JOIN #streamer');
    t.answer().resolve({ messages: [recent('H1', 'Alice', 'old')] });
    await t.flush();
    assert.deepEqual(t.delivered, []);
    t.receive(JOIN_ECHO);
    assert.deepEqual(t.delivered.map((l) => parseLine(l).command), ['JOIN', 'PRIVMSG']);
});

test('without history in time, live chat is let through as it is', async () => {
    const t = session({ history: true });
    t.s.onSend('JOIN #streamer');
    t.receive(JOIN_ECHO, live('L1', 'Dan', 'live'));
    assert.equal(t.delivered.length, 1);
    t.timers[0].fn(); // HISTORY_TIMEOUT_MS later
    assert.equal(textOf(t.delivered.at(-1)), 'live');
    t.answer().resolve({ messages: [recent('H1', 'Alice', 'too late')] });
    await t.flush();
    assert.ok(!t.delivered.some((l) => l.includes('too late')), 'late history is dropped');
    assert.ok(HISTORY_TIMEOUT_MS > 0);
});

test('a failed history fetch lets live chat through at once', async () => {
    const t = session({ history: true });
    t.s.onSend('JOIN #streamer');
    t.receive(JOIN_ECHO, live('L1', 'Dan', 'live'));
    t.answer().reject(new Error('HTTP 503'));
    await t.flush();
    assert.equal(textOf(t.delivered.at(-1)), 'live');
});

test('a message both in the history and live is shown once', async () => {
    const t = session({ history: true });
    t.s.onSend('JOIN #streamer');
    t.receive(JOIN_ECHO, live('X', 'Dan', 'same'));
    t.answer().resolve({ messages: [recent('X', 'Dan', 'same')] });
    await t.flush();
    assert.equal(t.delivered.filter((l) => l.includes('same')).length, 1);
});

test('joining again after a reconnect doesn\'t repeat history already shown', async () => {
    const seen = createSeenIds();
    const run = async () => {
        const delivered = [];
        let answer;
        const s = createChatSession({
            config: { history: true }, seen, deliver: (l) => delivered.push(...l),
            fetchHistory: () => new Promise((resolve) => { answer = resolve; }), setTimer: () => () => {},
        });
        s.onSend('JOIN #streamer');
        delivered.push(...s.onReceive(JOIN_ECHO + '\r\n').lines);
        answer({ messages: [recent('H1', 'Alice', 'old'), recent('H2', 'Bob', 'newer')] });
        await new Promise((r) => setImmediate(r));
        return delivered.filter((l) => parseLine(l).command === 'PRIVMSG').map(textOf);
    };
    assert.deepEqual(await run(), ['old', 'newer']);
    assert.deepEqual(await run(), []);
});

test('filters apply to live chat and to history alike', async () => {
    const t = session({ history: true, users: ['alice'], hideCommands: true });
    t.s.onSend('JOIN #streamer');
    t.receive(JOIN_ECHO);
    t.answer().resolve({ messages: [recent('H1', 'Alice', 'hidden'), recent('H2', 'Bob', '!cmd'), recent('H3', 'Bob', 'shown')] });
    await t.flush();
    t.receive(live('L1', 'Alice', 'hidden live'), live('L2', 'Dan', 'shown live'));
    assert.deepEqual(t.delivered.filter((l) => parseLine(l).command === 'PRIVMSG').map(textOf), ['shown', 'shown live']);
});

test('with history off, filters still work and nothing is held back', () => {
    const t = session({ history: false, users: ['alice'] });
    t.s.onSend('JOIN #streamer');
    t.receive(JOIN_ECHO, live('1', 'Alice', 'hidden'), live('2', 'Dan', 'shown'));
    assert.equal(t.answer(), undefined, 'no history fetched');
    assert.deepEqual(t.delivered.map((l) => parseLine(l).command), ['JOIN', 'PRIVMSG']);
});

test('other channels and other traffic are never held back', () => {
    const t = session({ history: true });
    t.s.onSend('JOIN #streamer');
    t.receive('PING :tmi.twitch.tv', live('1', 'Dan', 'elsewhere', '#other'), 'garbage');
    assert.deepEqual(t.delivered, ['PING :tmi.twitch.tv', live('1', 'Dan', 'elsewhere', '#other'), 'garbage']);
});

// ---- The page's WebSocket ---------------------------------------------------------------

class FakeSocket extends EventTarget {
    static OPEN = 1;
    constructor(url) {
        super();
        this.url = url;
        this.readyState = 1;
        this.sent = [];
        FakeSocket.last = this;
    }
    send(data) { this.sent.push(data); }
    // Like a browser's event handler property: it takes its place among the listeners when
    // first set.
    get onmessage() { return this.handler || null; }
    set onmessage(fn) {
        if (!this.handler) this.addEventListener('message', (e) => this.handler && this.handler(e));
        this.handler = fn;
    }
    // A frame from the server, the way a browser delivers it: listeners, then onmessage.
    serverSends(...lines) { this.dispatchEvent(new MessageEvent('message', { data: lines.map((l) => l + '\r\n').join('') })); }
}

function fakeWindow(fetchJson) {
    return {
        WebSocket: FakeSocket,
        MessageEvent,
        setTimeout,
        clearTimeout,
        fetch: async (url) => ({ ok: true, json: async () => fetchJson(url) }),
    };
}

// What Twitch's app sees: its handlers on the socket.
function appHandlers(socket) {
    const got = [];
    socket.onmessage = (e) => got.push(...e.data.split('\r\n').filter(Boolean));
    return got;
}

test('the page\'s WebSocket is the same class, and only chat sockets are touched', () => {
    const win = fakeWindow(() => ({ messages: [] }));
    install(win, { users: ['alice'] });
    const other = new win.WebSocket('wss://pubsub-edge.twitch.tv/v1');
    assert.ok(other instanceof FakeSocket);
    assert.equal(win.WebSocket.OPEN, 1);
    const got = [];
    other.addEventListener('message', (e) => got.push(e.data));
    other.serverSends(live('1', 'Alice', 'not chat'));
    assert.equal(got.length, 1, 'non-chat sockets are left alone');
});

test('Twitch\'s app gets filtered chat and the history through its own handlers', async () => {
    const win = fakeWindow((url) => {
        assert.match(url, /recent-messages\/streamer\?/);
        return { messages: [recent('H1', 'Bob', 'from before'), recent('H2', 'Alice', 'hidden old')] };
    });
    install(win, { history: true, users: ['alice'] });
    const socket = new win.WebSocket('wss://irc-ws.chat.twitch.tv:443');
    const got = appHandlers(socket);
    const listened = [];
    socket.addEventListener('message', (e) => listened.push(e.data));

    socket.send('JOIN #streamer');
    assert.deepEqual(socket.sent, ['JOIN #streamer'], 'the app\'s frames are still sent');
    socket.serverSends(JOIN_ECHO);
    await new Promise((r) => setTimeout(r, 10));
    socket.serverSends(live('L1', 'Alice', 'hidden live'), live('L2', 'Dan', 'live'));

    assert.deepEqual(got.map((l) => parseLine(l).command === 'PRIVMSG' ? textOf(l) : parseLine(l).command), ['JOIN', 'from before', 'live']);
    assert.equal(listened.join('').split('\r\n').filter(Boolean).length, 3, 'addEventListener handlers see the same');
});
