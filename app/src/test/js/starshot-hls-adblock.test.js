const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { stripAds, isPlaylistUrl, filterPlaylist } = require(
    path.join(__dirname, '../../main/assets/scripts/starshot-hls-adblock.js'),
);

const AD_DATERANGE = '#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",START-DATE="2026-10-19T12:00:00Z"';

function playlist({ sequence = 100, discontinuitySequence, segments, trailer = [] }) {
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:6', `#EXT-X-MEDIA-SEQUENCE:${sequence}`];
    if (discontinuitySequence !== undefined) lines.push(`#EXT-X-DISCONTINUITY-SEQUENCE:${discontinuitySequence}`);
    for (const s of segments) {
        if (s.discontinuity) lines.push('#EXT-X-DISCONTINUITY');
        if (s.daterange) lines.push(s.daterange);
        lines.push(`#EXT-X-PROGRAM-DATE-TIME:2026-10-19T12:00:${String(s.n).padStart(2, '0')}Z`);
        lines.push(s.ad ? '#EXTINF:2.000,Amazon' : '#EXTINF:2.000,live');
        lines.push(`https://video-edge.example.ttvnw.net/v1/segment/${s.ad ? 'ad' : 'live'}-${s.n}.ts`);
    }
    return lines.concat(trailer).join('\n') + '\n';
}

function segmentUris(text) {
    return text.split('\n').filter((l) => l.startsWith('https://')).map((l) => l.split('/').pop());
}

function header(text, tag) {
    const line = text.split('\n').find((l) => l.startsWith(`#${tag}:`));
    return line && Number(line.split(':')[1]);
}

test('leaves playlists without ad markers untouched', () => {
    const input = playlist({ segments: [{ n: 1 }, { n: 2 }], trailer: ['#EXT-X-TWITCH-PREFETCH:https://x/next.ts'] });
    const { playlist: out, removed, complete } = stripAds(input);
    assert.deepEqual({ out, removed, complete }, { out: input, removed: 0, complete: true });
});

test('does not treat the ad trigger DATERANGE on normal live playlists as an ad', () => {
    const input = playlist({
        segments: [
            { n: 1, daterange: '#EXT-X-DATERANGE:ID="trigger-1",CLASS="twitch-trigger",START-DATE="2026-10-19T19:14:46.743Z",END-ON-NEXT=YES,X-TV-TWITCH-TRIGGER-URL="https://example"' },
            { n: 2 },
        ],
    });
    const { playlist: out, removed, complete } = stripAds(input);
    assert.deepEqual({ out, removed, complete }, { out: input, removed: 0, complete: true });
});

test('drops trailing ad segments and their prefetch hints', () => {
    const input = playlist({
        segments: [{ n: 1 }, { n: 2 }, { n: 3, ad: true, discontinuity: true, daterange: AD_DATERANGE }, { n: 4, ad: true }],
        trailer: ['#EXT-X-TWITCH-PREFETCH:https://x/ad-5.ts'],
    });
    const result = stripAds(input);
    assert.deepEqual(segmentUris(result.playlist), ['live-1.ts', 'live-2.ts']);
    assert.equal(header(result.playlist, 'EXT-X-MEDIA-SEQUENCE'), 100);
    assert.equal(result.removed, 2);
    assert.equal(result.complete, false);
    assert.ok(!result.playlist.includes('PREFETCH'));
    assert.ok(!result.playlist.includes('stitched-ad'));
});

test('drops leading ad segments and advances media and discontinuity sequences', () => {
    const input = playlist({
        discontinuitySequence: 4,
        segments: [
            { n: 1, ad: true, discontinuity: true, daterange: AD_DATERANGE },
            { n: 2, ad: true },
            { n: 3, discontinuity: true },
            { n: 4 },
        ],
        trailer: ['#EXT-X-TWITCH-PREFETCH:https://x/live-5.ts'],
    });
    const result = stripAds(input);
    assert.deepEqual(segmentUris(result.playlist), ['live-3.ts', 'live-4.ts']);
    assert.equal(header(result.playlist, 'EXT-X-MEDIA-SEQUENCE'), 102);
    assert.equal(header(result.playlist, 'EXT-X-DISCONTINUITY-SEQUENCE'), 5);
    assert.equal(result.complete, true);
    assert.ok(result.playlist.includes('#EXT-X-TWITCH-PREFETCH:https://x/live-5.ts'));
});

test('adds a discontinuity sequence when leading ads carried discontinuities', () => {
    const input = playlist({
        segments: [{ n: 1, ad: true, discontinuity: true, daterange: AD_DATERANGE }, { n: 2, discontinuity: true }],
    });
    assert.equal(header(stripAds(input).playlist, 'EXT-X-DISCONTINUITY-SEQUENCE'), 1);
});

test('skips to the live run after an ad break that sits mid-window', () => {
    const input = playlist({
        segments: [{ n: 1 }, { n: 2, ad: true, daterange: AD_DATERANGE }, { n: 3 }],
    });
    const result = stripAds(input);
    assert.deepEqual(segmentUris(result.playlist), ['live-3.ts']);
    assert.equal(header(result.playlist, 'EXT-X-MEDIA-SEQUENCE'), 102);
    assert.equal(result.complete, true);
});

test('keeps the init segment when the segments it sat above are dropped', () => {
    const input = playlist({
        segments: [{ n: 1, ad: true, daterange: AD_DATERANGE }, { n: 2, ad: true }, { n: 3 }, { n: 4 }],
    }).replace('#EXT-X-DATERANGE', '#EXT-X-MAP:URI="https://video-edge.example.ttvnw.net/v1/segment/init.mp4"\n#EXT-X-DATERANGE');
    const lines = stripAds(input).playlist.split('\n');
    const map = lines.findIndex((l) => l.startsWith('#EXT-X-MAP:'));
    assert.ok(map >= 0, 'init segment kept');
    assert.ok(map < lines.findIndex((l) => l.endsWith('live-3.ts')), 'init segment comes before the first kept segment');
});

test('treats SCTE-35 cue-out ranges as ads even when titled live', () => {
    const input = playlist({ segments: [{ n: 1 }] }) +
        '#EXT-X-CUE-OUT:30\n#EXTINF:2.000,live\nhttps://video-edge.example.ttvnw.net/v1/segment/cue-2.ts\n';
    assert.deepEqual(segmentUris(stripAds(input).playlist), ['live-1.ts']);
});

test('holds the last live playlist for a URL while the whole window is ads', () => {
    const url = 'https://video-weaver.example.hls.ttvnw.net/v1/playlist/hold.m3u8';
    const live = playlist({ segments: [{ n: 1 }, { n: 2 }] });
    const allAds = playlist({ sequence: 103, segments: [{ n: 3, ad: true, daterange: AD_DATERANGE }, { n: 4, ad: true }] });
    assert.equal(filterPlaylist(url, live), live);
    assert.equal(filterPlaylist(url, allAds), live);
});

test('holds the last live playlist once ads reach the live edge, then resumes after them', () => {
    const url = 'https://use16.playlist.ttvnw.net/v1/playlist/edge.m3u8';
    const live = playlist({ segments: [{ n: 1 }, { n: 2 }, { n: 3 }] });
    const adsAtEdge = playlist({ sequence: 101, segments: [{ n: 2 }, { n: 3 }, { n: 4, ad: true, daterange: AD_DATERANGE }] });
    const resumed = playlist({ sequence: 104, segments: [{ n: 4, ad: true, daterange: AD_DATERANGE }, { n: 5, discontinuity: true }] });
    assert.equal(filterPlaylist(url, live), live);
    assert.equal(filterPlaylist(url, adsAtEdge), live);
    const after = filterPlaylist(url, resumed);
    assert.deepEqual(segmentUris(after), ['live-5.ts']);
    assert.equal(header(after, 'EXT-X-MEDIA-SEQUENCE'), 105);
});

test('ignores master playlists and non-playlist text', () => {
    const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://x/index.m3u8\n';
    assert.equal(filterPlaylist('https://usher.ttvnw.net/api/channel/hls/x.m3u8', master), master);
});

test('only matches Twitch playlist URLs', () => {
    assert.ok(isPlaylistUrl('https://usher.ttvnw.net/api/v2/channel/hls/somechannel.m3u8?sig=1'));
    assert.ok(isPlaylistUrl('https://video-weaver.fra05.hls.ttvnw.net/v1/playlist/abc.m3u8'));
    assert.ok(!isPlaylistUrl('https://video-edge.ttvnw.net/v1/segment/abc.ts'));
    assert.ok(!isPlaylistUrl('https://evil.example/ttvnw.net/x.m3u8'));
});

test('lets a preroll play when joining before any live segment exists', () => {
    // Shape of a real join on sips_: the session playlist starts at sequence 0 with the preroll.
    const url = 'https://use16.playlist.ttvnw.net/v1/playlist/preroll.m3u8';
    const preroll = playlist({
        sequence: 0,
        segments: [{ n: 0, ad: true, daterange: AD_DATERANGE }, { n: 1, ad: true }, { n: 2, ad: true }],
    });
    assert.equal(filterPlaylist(url, preroll), preroll, 'nothing live to hold yet, so the preroll is passed through');

    const prerollEnding = playlist({
        sequence: 1,
        segments: [{ n: 1, ad: true, daterange: AD_DATERANGE }, { n: 2, ad: true }, { n: 3, discontinuity: true }, { n: 4 }],
    });
    assert.equal(filterPlaylist(url, prerollEnding), prerollEnding, 'the player plays on from the preroll into live');

    const midroll = playlist({ sequence: 5, segments: [{ n: 5, ad: true, daterange: AD_DATERANGE }, { n: 6, ad: true }] });
    assert.equal(filterPlaylist(url, midroll), prerollEnding, 'later breaks still hold the last live playlist');
});

test('never hands the player a media playlist without segments', () => {
    let n = 0;
    for (let length = 1; length <= 6; length++) {
        for (let mask = 0; mask < 1 << length; mask++) {
            const segments = Array.from({ length }, (_, i) => ({ n: i, ad: Boolean(mask & (1 << i)), daterange: i === 0 && mask & 1 ? AD_DATERANGE : undefined }));
            const input = playlist({ sequence: 10, segments });
            const out = filterPlaylist(`https://use16.playlist.ttvnw.net/v1/playlist/fresh-${n++}.m3u8`, input);
            assert.ok(segmentUris(out).length > 0, `empty playlist for pattern ${mask.toString(2).padStart(length, '0')}`);
        }
    }
});

// Twitch's session playlists: numbered from 0 when the viewer joins, keeping every segment
// for the first minute, and with no discontinuity where ads switch to live (only the
// segment titles change).
function sessionPlaylist(last, ads, session = '42') {
    const segments = [];
    for (let n = 0; n <= last; n++) {
        const ad = ads.some(([from, to]) => n >= from && n < to);
        segments.push({ n, ad, daterange: ads.some(([from]) => n === from) ? AD_DATERANGE : undefined });
    }
    return playlist({ sequence: 0, segments }).replace(
        '#EXT-X-MEDIA-SEQUENCE:0',
        `#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-DATERANGE:ID="playlist-session-1",CLASS="twitch-session",START-DATE="2026-10-20T00:00:00Z",END-ON-NEXT=YES,X-TV-TWITCH-SESSIONID="${session}"`,
    );
}

test('moves on to live after a mid-roll in a session playlist', () => {
    // A 10-segment break at 15..24 while the player reloads the playlist every segment.
    const url = 'https://use12.playlist.ttvnw.net/v1/playlist/session-midroll.m3u8';
    let lastSegment = -1;
    let stuck = 0;
    for (let edge = 10; edge <= 40; edge++) {
        const uris = segmentUris(filterPlaylist(url, sessionPlaylist(edge, [[15, 25]], 'midroll')));
        assert.ok(uris.every((u) => u.startsWith('live-')), `no ads handed to the player at edge ${edge}`);
        const newest = Number(uris[uris.length - 1].match(/\d+/)[0]);
        stuck = newest === lastSegment ? stuck + 1 : 0;
        lastSegment = newest;
        if (edge >= 25) assert.equal(newest, edge, `playlist reaches the live edge at ${edge}`);
    }
    assert.equal(stuck, 0);
    const after = filterPlaylist(url, sessionPlaylist(40, [[15, 25]], 'midroll'));
    assert.equal(header(after, 'EXT-X-MEDIA-SEQUENCE'), 25);
});

test('plays on from a started preroll into live, on every quality level of the session', () => {
    const level1 = 'https://use12.playlist.ttvnw.net/v1/playlist/level-1.m3u8';
    const level2 = 'https://use12.playlist.ttvnw.net/v1/playlist/level-2.m3u8';
    const joining = sessionPlaylist(2, [[0, 8]], 'preroll');
    assert.equal(filterPlaylist(level1, joining), joining, 'nothing live yet, so the preroll plays');

    // The rest of the preroll and the switch to live, after the player changed quality level.
    const ending = sessionPlaylist(11, [[0, 8]], 'preroll');
    assert.equal(filterPlaylist(level2, ending), ending, 'ads the player has started stay in place');

    // A mid-roll later in the same session is still skipped.
    const midroll = sessionPlaylist(30, [[0, 8], [20, 26]], 'preroll');
    const out = filterPlaylist(level2, midroll);
    assert.deepEqual(segmentUris(out), ['live-26.ts', 'live-27.ts', 'live-28.ts', 'live-29.ts', 'live-30.ts']);
});

test('never hands the player a media playlist without segments', () => {
    let n = 0;
    for (let length = 1; length <= 6; length++) {
        for (let mask = 0; mask < 1 << length; mask++) {
            const segments = Array.from({ length }, (_, i) => ({ n: i, ad: Boolean(mask & (1 << i)), daterange: i === 0 && mask & 1 ? AD_DATERANGE : undefined }));
            const input = playlist({ sequence: 10, segments });
            const out = filterPlaylist(`https://use16.playlist.ttvnw.net/v1/playlist/fresh-${n++}.m3u8`, input);
            assert.ok(segmentUris(out).length > 0, `empty playlist for pattern ${mask.toString(2).padStart(length, '0')}`);
        }
    }
});
