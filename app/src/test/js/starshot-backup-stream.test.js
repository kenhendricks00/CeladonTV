const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const filter = require(path.join(__dirname, '../../main/assets/scripts/starshot-hls-adblock.js'));
const { filterPlaylist, parseMaster, pickRendition } = filter;

const BASE = Date.parse('2026-10-20T20:00:00.000Z');
const AD_DATERANGE = '#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",START-DATE="2026-10-20T20:00:00Z"';

// A live media playlist. `live` maps a live segment's number to its broadcast slot (2s
// each), so ad segments can sit anywhere and number the main playlist differently from
// the backup. `prefix` tells main and backup segment URIs apart.
function media({ segments, sequence, prefix, map, session = '42' }) {
    const lines = ['#EXTM3U', '#EXT-X-VERSION:6', '#EXT-X-TARGETDURATION:6', `#EXT-X-MEDIA-SEQUENCE:${sequence}`];
    lines.push(`#EXT-X-DATERANGE:ID="playlist-session-1",CLASS="twitch-session",START-DATE="2026-10-20T20:00:00Z",END-ON-NEXT=YES,X-TV-TWITCH-SESSIONID="${session}"`);
    if (map) lines.push(`#EXT-X-MAP:URI="https://video-edge.example.ttvnw.net/v1/segment/${prefix}init.mp4"`);
    for (const s of segments) {
        if (s.daterange) lines.push(s.daterange);
        lines.push('#EXT-X-PROGRAM-DATE-TIME:' + new Date(s.pdt).toISOString());
        lines.push(s.ad ? `#EXTINF:${(s.dur || 2000) / 1000},Amazon|1` : '#EXTINF:2.000,live');
        lines.push(`https://video-edge.example.ttvnw.net/v1/segment/${prefix}${s.ad ? 'ad' : 'live'}-${s.slot}.ts`);
    }
    return lines.join('\n') + '\n';
}

// The backup's 16-segment window ending at broadcast slot `edge`, numbered by slot.
function backupWindow(edge, opts = {}) {
    const segments = [];
    for (let slot = edge - 15; slot <= edge; slot++) segments.push({ slot, pdt: BASE + slot * 2000 });
    return media({ segments, sequence: edge - 15 + (opts.offset || 0), prefix: 'b-', map: opts.map, session: '99' });
}

// The main playlist's 16-segment sliding window ending at slot `edge`, numbered by slot,
// with slots in [from, to) replaced by ads (stitched-ad tag on the first ad only).
function mainWindow(edge, [from, to], opts = {}) {
    const segments = [];
    for (let slot = edge - 15; slot <= edge; slot++) {
        const ad = slot >= from && slot < to;
        segments.push({ slot, pdt: BASE + slot * 2000, ad, daterange: slot === from ? AD_DATERANGE : undefined });
    }
    return media({ segments, sequence: edge - 15, prefix: 'm-', map: opts.map, session: opts.session });
}

function segments(text) {
    const out = [];
    const lines = text.split('\n');
    let sn = Number(lines.find((l) => l.startsWith('#EXT-X-MEDIA-SEQUENCE:')).split(':')[1]);
    let pdt = null;
    for (const line of lines) {
        if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) pdt = Date.parse(line.slice(25));
        if (line.startsWith('https://') && line.endsWith('.ts')) out.push({ sn: sn++, pdt, uri: line.split('/').pop() });
    }
    return out;
}

let clock = BASE;
filter.setClock(() => clock);

function freshFilter() {
    filter.reset();
    clock = BASE;
}

test('reads renditions from a master playlist and picks the one closest to the playing one', () => {
    const master = [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.64002A,mp4a.40.2",FRAME-RATE=60.000',
        'https://use12.playlist.ttvnw.net/v1/playlist/1080p60.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4D401F,mp4a.40.2",FRAME-RATE=30.000',
        'https://use12.playlist.ttvnw.net/v1/playlist/720p30.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360,CODECS="avc1.4D401E,mp4a.40.2",FRAME-RATE=30.000',
        'https://use12.playlist.ttvnw.net/v1/playlist/360p30.m3u8',
    ].join('\n');
    const renditions = parseMaster(master, 'https://usher.ttvnw.net/api/channel/hls/x.m3u8');
    assert.deepEqual(renditions.map((r) => r.resolution), ['1920x1080', '1280x720', '640x360']);
    const pick = (wanted) => pickRendition(renditions, wanted).resolution;
    assert.equal(pick({ resolution: '1280x720', height: 720, frameRate: 30, codecs: 'avc1.4D401F' }), '1280x720');
    assert.equal(pick({ resolution: '852x480', height: 480, frameRate: 30, codecs: 'avc1.4D401F' }), '640x360', 'the tallest one below');
    assert.equal(pick({ resolution: '284x160', height: 160, frameRate: 30, codecs: 'avc1.4D401F' }), '640x360', 'else the smallest');
    assert.equal(pick(null), '1920x1080');
});

test('plays through a mid-roll on the backup stream without leaving the timeline', () => {
    freshFilter();
    const url = 'https://use12.playlist.ttvnw.net/v1/playlist/midroll.m3u8';
    const ads = [41, 57];
    const pdtBySn = new Map();
    let lastEdge = 0;
    for (let edge = 30; edge <= 80; edge++) {
        clock = BASE + edge * 2000;
        const inBreak = edge >= ads[0] && edge < ads[1] + 16;
        // The XHR hook fetches a backup only while ads are in the main playlist.
        const out = filterPlaylist(url, mainWindow(edge, ads), inBreak ? backupWindow(edge) : undefined, 'embed');
        const segs = segments(out);
        assert.ok(segs.every((s) => !s.uri.includes('ad-')), `no ads at edge ${edge}`);
        const newest = segs[segs.length - 1];
        assert.equal(newest.sn, edge, `the player reaches the live edge at ${edge}`);
        assert.ok(newest.sn >= lastEdge);
        lastEdge = newest.sn;
        for (const s of segs) {
            if (pdtBySn.has(s.sn)) assert.equal(pdtBySn.get(s.sn), s.pdt, `segment ${s.sn} keeps its broadcast time`);
            pdtBySn.set(s.sn, s.pdt);
            assert.equal(s.pdt, BASE + s.sn * 2000);
        }
        if (edge >= ads[0] && edge < ads[1]) assert.ok(newest.uri.startsWith('b-'), `backup segments stand in for the ads at ${edge}`);
        if (edge >= ads[1] + 16) {
            const window = segs.filter((s) => s.sn > edge - 16);
            assert.ok(window.length === 16 && window.every((s) => s.uri.startsWith('m-')), `back on the main stream at ${edge}`);
        }
    }
});

test('numbers backup segments after the main ones in a session playlist that counts its ads', () => {
    freshFilter();
    const url = 'https://use12.playlist.ttvnw.net/v1/playlist/session.m3u8';
    // Session numbering from 0: slots 100..119 live, then 12 ads (2.5s each, so the main
    // playlist numbers differently from the broadcast slots), then live from slot 135.
    const main = (edgeSlot) => {
        const segs = [];
        for (let slot = 100; slot < 120; slot++) segs.push({ slot, pdt: BASE + slot * 2000 });
        for (let i = 0; i < 12 && segs.length < 200; i++) {
            const pdt = BASE + 120 * 2000 + i * 2500;
            if (pdt <= BASE + edgeSlot * 2000) segs.push({ slot: 1000 + i, pdt, ad: true, dur: 2500, daterange: i === 0 ? AD_DATERANGE : undefined });
        }
        for (let slot = 135; slot <= edgeSlot; slot++) segs.push({ slot, pdt: BASE + slot * 2000 });
        return media({ segments: segs, sequence: 0, prefix: 'm-' });
    };
    let previousEnd = -1;
    const pdtBySn = new Map();
    for (let edge = 119; edge <= 150; edge++) {
        clock = BASE + edge * 2000;
        const out = filterPlaylist(url, main(edge), edge >= 120 && edge < 150 ? backupWindow(edge, { offset: 5000 }) : undefined, 'site');
        const segs = segments(out);
        assert.ok(segs.every((s) => !s.uri.includes('ad-')), `no ads at ${edge}`);
        const newest = segs[segs.length - 1];
        assert.ok(newest.pdt >= BASE + (edge - 1) * 2000, `reaches the edge at ${edge}`);
        assert.ok(newest.sn >= previousEnd);
        previousEnd = newest.sn;
        for (const s of segs) {
            if (pdtBySn.has(s.sn)) assert.equal(pdtBySn.get(s.sn), s.pdt, `segment ${s.sn} keeps its broadcast time`);
            pdtBySn.set(s.sn, s.pdt);
        }
        if (edge === 119) assert.equal(newest.sn, 19, 'the main numbering before the break');
    }
    // Slot 120 follows slot 119 (number 19) whichever stream it came from.
    assert.equal(pdtBySn.get(20), BASE + 120 * 2000);
});

test('joining during a break plays the backup at once and never hands the player ads', () => {
    freshFilter();
    const url = 'https://use12.playlist.ttvnw.net/v1/playlist/join.m3u8';
    clock = BASE + 50 * 2000;
    const first = segments(filterPlaylist(url, mainWindow(50, [20, 60]), backupWindow(50), 'autoplay'));
    assert.ok(first.length > 0 && first.every((s) => s.uri.startsWith('b-')));
    assert.equal(first[first.length - 1].sn, 50);
    for (let edge = 51; edge <= 80; edge++) {
        clock = BASE + edge * 2000;
        const segs = segments(filterPlaylist(url, mainWindow(edge, [20, 60]), edge < 76 ? backupWindow(edge) : undefined, 'autoplay'));
        assert.ok(segs.every((s) => !s.uri.includes('ad-')), `no ads at ${edge}`);
        assert.equal(segs[segs.length - 1].sn, edge, `at the live edge at ${edge}`);
    }
});

test('falls back to holding the last live frame when no backup without ads is found', () => {
    freshFilter();
    const url = 'https://use12.playlist.ttvnw.net/v1/playlist/nobackup.m3u8';
    clock = BASE + 40 * 2000;
    const live = filterPlaylist(url, mainWindow(40, [41, 57]));
    clock += 2000;
    assert.equal(filterPlaylist(url, mainWindow(41, [41, 57]), null), live, 'holds');
    clock += 2000;
    assert.equal(filterPlaylist(url, mainWindow(42, [41, 57])), live, 'still holds');
});

test('carries the backup init segment in front of backup segments', () => {
    freshFilter();
    const url = 'https://use12.playlist.ttvnw.net/v1/playlist/fmp4.m3u8';
    clock = BASE + 40 * 2000;
    filterPlaylist(url, mainWindow(40, [41, 57], { map: true }));
    clock += 4000;
    const out = filterPlaylist(url, mainWindow(42, [41, 57], { map: true }), backupWindow(42, { map: true }), 'embed').split('\n');
    const backupMap = out.findIndex((l) => l.includes('b-init.mp4'));
    const firstBackup = out.findIndex((l) => l.includes('/b-live-'));
    assert.ok(out.findIndex((l) => l.includes('m-init.mp4')) < out.findIndex((l) => l.includes('/m-live-')));
    assert.ok(backupMap >= 0 && backupMap < firstBackup, 'the backup init segment comes before its segments');
});

// ---- The XHR hook: a break's first playlist waits for the backup ----------------------

class FakeXHR {
    open(method, url) {
        this.url = url;
        this.readyState = 1;
    }
    send() {
        setTimeout(() => {
            this.readyState = 4;
            this.status = 200;
            this.text = FakeXHR.server(this.url);
            if (this.handler) this.handler.call(this, { type: 'readystatechange' });
        }, 0);
    }
}
Object.defineProperty(FakeXHR.prototype, 'responseText', { configurable: true, get() { return this.text; } });
Object.defineProperty(FakeXHR.prototype, 'response', { configurable: true, get() { return this.text; } });
Object.defineProperty(FakeXHR.prototype, 'onreadystatechange', {
    configurable: true,
    get() { return this.handler; },
    set(handler) { this.handler = handler; },
});

function load(XHR, url) {
    return new Promise((resolve) => {
        const xhr = new XHR();
        xhr.open('GET', url);
        xhr.onreadystatechange = function () {
            if (this.readyState === 4) {
                this.onreadystatechange = null;
                resolve(this.responseText);
            }
        };
        xhr.send();
    });
}

test('delays a break playlist until a backup without ads is fetched, skipping types that have ads', async () => {
    freshFilter();
    const usher = 'https://usher.ttvnw.net/api/channel/hls/somechannel.m3u8?player_type=pulsar&sig=main&token=main';
    const master = (type) => `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4D401F,mp4a.40.2",FRAME-RATE=30.000\nhttps://use12.playlist.ttvnw.net/v1/playlist/${type}-720p.m3u8\n`;
    const mainUrl = 'https://use12.playlist.ttvnw.net/v1/playlist/main-720p.m3u8';
    const requests = [];
    const win = {
        fetch: async (url, init) => {
            requests.push(String(url));
            if (url === 'https://gql.twitch.tv/gql') {
                const { variables } = JSON.parse(init.body);
                if (!variables) return new Response('{}');
                assert.equal(init.headers['Client-Id'], 'tv-client');
                assert.equal(variables.login, 'somechannel');
                return new Response(JSON.stringify({ data: { streamPlaybackAccessToken: { value: `{"player_type":"${variables.playerType}"}`, signature: 'sig-' + variables.playerType } } }));
            }
            if (url.startsWith('https://usher.ttvnw.net/')) {
                const u = new URL(url);
                assert.equal(u.searchParams.get('sig'), 'sig-' + u.searchParams.get('player_type'));
                return new Response(master(u.searchParams.get('player_type')));
            }
            if (url.includes('/embed-720p.m3u8')) return new Response(mainWindow(45, [41, 57]).replace(/m-/g, 'e-'));
            if (url.includes('/site-720p.m3u8')) return new Response(backupWindow(45));
            return new Response('', { status: 404 });
        },
    };
    filter.hookFetch(win);
    filter.hookXhr(FakeXHR);
    await win.fetch('https://gql.twitch.tv/gql', { method: 'POST', headers: { 'Client-Id': 'tv-client', 'Device-Id': 'dev' }, body: '{}' });
    clock = BASE + 40 * 2000;
    FakeXHR.server = (url) => (url.startsWith('https://usher') ? master('main') : mainWindow(40, [41, 57]));
    await load(FakeXHR, usher);
    await load(FakeXHR, mainUrl);
    clock = BASE + 45 * 2000;
    FakeXHR.server = () => mainWindow(45, [41, 57]);
    const out = segments(await load(FakeXHR, mainUrl));
    assert.ok(out.every((s) => !s.uri.includes('ad-')));
    assert.equal(out[out.length - 1].sn, 45);
    assert.ok(out[out.length - 1].uri.startsWith('b-'), 'the site stream stood in; embed had ads');
    assert.ok(requests.some((u) => u.includes('player_type=embed')) && requests.some((u) => u.includes('player_type=site')));
});

test('uses the backup for a later break once ads passed to the player have played on into live', () => {
    freshFilter();
    const url = 'https://use12.playlist.ttvnw.net/v1/playlist/after-join.m3u8';
    // Joined during a break with no clean backup: the ads were handed to the player.
    clock = BASE + 30 * 2000;
    const joined = filterPlaylist(url, mainWindow(30, [0, 33]), null);
    assert.ok(segments(joined).every((s) => s.uri.includes('ad-')));
    // The break ends and live follows the ads in sequence.
    let lastSn = 0;
    for (let edge = 31; edge <= 60; edge++) {
        clock = BASE + edge * 2000;
        const segs = segments(filterPlaylist(url, mainWindow(edge, [0, 33])));
        lastSn = segs[segs.length - 1].sn;
    }
    assert.equal(lastSn, 60);
    // A mid-roll later: the backup stands in, numbered on from the live segments.
    for (let edge = 61; edge <= 70; edge++) {
        clock = BASE + edge * 2000;
        const segs = segments(filterPlaylist(url, mainWindow(edge, [0, 33], {}).replace(/live-(6[1-9]|70)\.ts/g, 'ad-$1.ts').replace(/#EXTINF:2.000,live\n(https:[^\n]*ad-)/g, '#EXTINF:2.000,Amazon|1\n$1'), backupWindow(edge), 'embed'));
        assert.ok(segs.every((s) => !s.uri.includes('ad-')), `no ads at ${edge}`);
        assert.equal(segs[segs.length - 1].sn, edge, `at the live edge at ${edge}`);
        assert.ok(segs[segs.length - 1].uri.startsWith('b-'));
    }
});

test('opens the warm backup sessions as soon as a stream starts', async () => {
    freshFilter();
    const requests = [];
    const win = {
        fetch: async (url, init) => {
            requests.push({ url: String(url), playerType: init && init.body && (JSON.parse(init.body).variables || {}).playerType });
            if (url === 'https://gql.twitch.tv/gql') {
                const { variables } = JSON.parse(init.body);
                if (!variables) return new Response('{}');
                return new Response(JSON.stringify({ data: { streamPlaybackAccessToken: { value: '{}', signature: 's' } } }));
            }
            if (url.startsWith('https://usher.ttvnw.net/')) {
                const type = new URL(url).searchParams.get('player_type');
                return new Response(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1280x720\nhttps://use12.playlist.ttvnw.net/v1/playlist/${type}.m3u8\n`);
            }
            return new Response(backupWindow(10));
        },
    };
    filter.hookFetch(win);
    await win.fetch('https://gql.twitch.tv/gql', { method: 'POST', headers: { 'Client-Id': 'tv-client' }, body: '{}' });
    filterPlaylist('https://usher.ttvnw.net/api/channel/hls/somechannel.m3u8?sig=a&token=b', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1280x720\nhttps://use12.playlist.ttvnw.net/v1/playlist/main.m3u8\n');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const tokens = requests.filter((r) => r.playerType).map((r) => r.playerType);
    assert.deepEqual(tokens.sort(), ['embed', 'popout']);
    assert.ok(requests.some((r) => r.url.endsWith('/embed.m3u8')) && requests.some((r) => r.url.endsWith('/popout.m3u8')), 'their playlists are opened');
});
