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
    assert.deepEqual(stripAds(input), { playlist: input, removed: 0, complete: true });
});

test('does not treat the ad trigger DATERANGE on normal live playlists as an ad', () => {
    const input = playlist({
        segments: [
            { n: 1, daterange: '#EXT-X-DATERANGE:ID="trigger-1",CLASS="twitch-trigger",START-DATE="2026-10-19T19:14:46.743Z",END-ON-NEXT=YES,X-TV-TWITCH-TRIGGER-URL="https://example"' },
            { n: 2 },
        ],
    });
    assert.deepEqual(stripAds(input), { playlist: input, removed: 0, complete: true });
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

test('keeps only the first live run when an ad break sits mid-window', () => {
    const input = playlist({
        segments: [{ n: 1 }, { n: 2, ad: true, daterange: AD_DATERANGE }, { n: 3 }],
    });
    const result = stripAds(input);
    assert.deepEqual(segmentUris(result.playlist), ['live-1.ts']);
    assert.equal(header(result.playlist, 'EXT-X-MEDIA-SEQUENCE'), 100);
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
