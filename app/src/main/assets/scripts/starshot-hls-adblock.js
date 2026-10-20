// CeladonTV hls.js adapter.
//
// Twitch's TV web app ("Starshot") plays streams with hls.js
// on the main thread instead of the Amazon IVS worker that the TwitchAdSolutions
// scripts hook. This filters stitched ad segments out of media playlists as hls.js
// loads them, keeping media/discontinuity sequence numbers consistent so the player
// simply waits out the ad break instead of showing it.
(function () {
    'use strict';

    // Live playlists always carry a CLASS="twitch-trigger" DATERANGE, so it is not an ad marker.
    const AD_SIGNIFIERS = ['stitched-ad', 'EXT-X-CUE-OUT', 'twitch-stitched', 'CLASS="twitch-maf-ad"'];
    const AD_URL_PATTERNS = ['/adsquared/', '/_404/', '/processing'];
    const SEGMENT_TAG = /^#(EXTINF|EXT-X-PROGRAM-DATE-TIME|EXT-X-DISCONTINUITY(?!-SEQUENCE)|EXT-X-DATERANGE|EXT-X-BYTERANGE|EXT-X-KEY|EXT-X-MAP|EXT-X-GAP|EXT-X-CUE)/;
    const LOG_PREFIX = '[CeladonTV]';

    // Twitch titles live segments "live" and stitched ads after their source ("Amazon|...",
    // "DCM|..."); VOD segments have no title.
    const AD_TITLE = /^#EXTINF:[^,\n]*,(?!live\s*$)\S/m;

    function hasAdTags(text) {
        return AD_SIGNIFIERS.some((s) => text.includes(s));
    }

    // The stitched-ad DATERANGE only sits above an ad's first segment, so a sliding window
    // can hold the rest of an ad without it; the segment titles still give the ad away.
    function hasAds(text) {
        return hasAdTags(text) || AD_TITLE.test(text);
    }

    function parse(playlist) {
        const header = [];
        const segments = [];
        let pending = [];
        let inHeader = true;
        let inCueOut = false;
        for (const line of playlist.split(/\r?\n/)) {
            if (line === '') continue;
            const isUri = !line.startsWith('#');
            if (inHeader && !isUri && !SEGMENT_TAG.test(line)) {
                header.push(line);
                continue;
            }
            inHeader = false;
            if (line.startsWith('#EXT-X-CUE-OUT')) inCueOut = true;
            else if (line.startsWith('#EXT-X-CUE-IN')) inCueOut = false;
            if (!isUri) {
                pending.push(line);
                continue;
            }
            const extinf = pending.find((l) => l.startsWith('#EXTINF')) || '';
            const isAd = inCueOut || !extinf.includes(',live') || AD_URL_PATTERNS.some((p) => line.includes(p));
            segments.push({ tags: pending, uri: line, isAd });
            pending = [];
        }
        return { header, segments, trailer: pending };
    }

    function shiftHeader(header, tag, delta) {
        if (delta === 0) return header;
        const prefix = '#' + tag + ':';
        let found = false;
        const shifted = header.map((line) => {
            if (!line.startsWith(prefix)) return line;
            found = true;
            return prefix + (parseInt(line.slice(prefix.length), 10) + delta);
        });
        if (!found) shifted.push(prefix + delta);
        return shifted;
    }

    function mediaSequence(header) {
        const line = header.find((l) => l.startsWith('#EXT-X-MEDIA-SEQUENCE:'));
        return line ? parseInt(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length), 10) : 0;
    }

    // Keeps the run of segments at the live edge: everything after the last ad, or,
    // while an ad break occupies the edge, the run just before it. A break shorter than
    // the window ends while live from before it is still in the window (and a session
    // playlist keeps every segment for its first minute); skipping to the run after the
    // break resumes playback as soon as live returns, not once the old live slides out.
    // Removing only from the ends keeps every kept segment's media sequence number
    // unchanged, which hls.js relies on.
    //
    // Ads with media sequence numbers up to `playedThrough`, and the rest of their
    // break, have already been handed to the player (a preroll) and are kept as content:
    // Twitch marks no discontinuity where ads switch to live, so hls.js can only get from
    // those ads to live by playing on through them.
    //
    // `complete` is false when ads reach the live edge (nothing usable to append).
    function stripAds(playlist, playedThrough = -1) {
        if (!hasAds(playlist)) return { playlist, removed: 0, kept: -1, live: -1, complete: true, playedThrough };
        const { header, segments, trailer } = parse(playlist);
        const first = mediaSequence(header);
        let played = false;
        const isAd = segments.map((s, i) => {
            played = s.isAd && (first + i <= playedThrough || played);
            if (played) playedThrough = Math.max(playedThrough, first + i);
            return s.isAd && !played;
        });
        let end = segments.length;
        while (end > 0 && isAd[end - 1]) end--;
        let start = end;
        while (start > 0 && !isAd[start - 1]) start--;
        if (start === 0 && end === segments.length) {
            return { playlist, removed: 0, kept: segments.length, live: -1, complete: true, playedThrough };
        }
        const dropped = segments.slice(0, start);
        const kept = segments.slice(start, end).map((s) => ({ ...s, tags: s.tags.filter((t) => !hasAdTags(t)) }));
        // Each segment uses the most recent init segment above it, which may be among those dropped.
        const map = dropped.flatMap((s) => s.tags).filter((t) => t.startsWith('#EXT-X-MAP')).pop();
        if (map && kept.length > 0 && !kept[0].tags.some((t) => t.startsWith('#EXT-X-MAP'))) {
            kept[0].tags = [map, ...kept[0].tags];
        }
        const droppedDiscontinuities = dropped.reduce((n, s) => n + s.tags.filter((t) => t === '#EXT-X-DISCONTINUITY').length, 0);
        let newHeader = shiftHeader(header, 'EXT-X-MEDIA-SEQUENCE', start);
        newHeader = shiftHeader(newHeader, 'EXT-X-DISCONTINUITY-SEQUENCE', droppedDiscontinuities);
        const lines = newHeader.slice();
        for (const s of kept) lines.push(...s.tags, s.uri);
        const truncated = end < segments.length;
        lines.push(...trailer.filter((t) => !truncated || t.startsWith('#EXT-X-ENDLIST')));
        return {
            playlist: lines.join('\n') + '\n',
            removed: isAd.filter(Boolean).length,
            kept: kept.length,
            live: segments.slice(start, end).filter((s) => !s.isAd).length,
            complete: kept.length > 0 && !truncated,
            playedThrough,
        };
    }

    function isPlaylistUrl(url) {
        return typeof url === 'string' && /\.m3u8(\?|$)/.test(url) && /^https:\/\/[^/]*\.(ttvnw\.net|twitch\.tv)\//.test(url);
    }

    // Playlist URL -> last playlist that reached the live edge. While ads occupy the
    // edge it is returned unchanged, so hls.js waits for new segments; a shrinking
    // trimmed window instead makes the player seek back and replay the last seconds.
    const lastLive = new Map();

    // Playback session -> media sequence number of the last ad handed to the player. Every
    // quality level of a session shares its numbering, so this is kept per session.
    const playedAds = new Map();

    function sessionKey(url, text) {
        const match = /X-TV-TWITCH-SESSIONID="([^"]+)"/.exec(text);
        return match ? match[1] : url;
    }

    // hls.js is never handed a media playlist without segments: Twitch's player gives up
    // (about 20s) if playback can't start, which is shorter than a preroll. With no live
    // playlist to hold yet (joining during a preroll), the ads are passed through.

    function filterPlaylist(url, text) {
        if (typeof text !== 'string' || !text.includes('#EXTINF')) return text;
        const session = sessionKey(url, text);
        const result = stripAds(text, playedAds.has(session) ? playedAds.get(session) : -1);
        if (playedAds.has(session)) playedAds.set(session, result.playedThrough);
        if (result.complete) {
            lastLive.set(url, result.playlist);
            if (result.removed > 0) console.log(LOG_PREFIX + ' removed ' + result.removed + ' ad segment(s)');
            return result.playlist;
        }
        const held = lastLive.get(url);
        if (held) {
            console.log(LOG_PREFIX + ' ad break: holding last live playlist');
            return held;
        }
        if (result.live > 0) return result.playlist;
        console.log(LOG_PREFIX + ' ad break before any live segments: letting it play');
        const { header, segments } = parse(text);
        playedAds.set(session, mediaSequence(header) + segments.length - 1);
        return text;
    }

    function hookXhr(XHR) {
        const proto = XHR.prototype;
        const realOpen = proto.open;
        proto.open = function (method, url) {
            this.__ctvPlaylistUrl = isPlaylistUrl(String(url)) ? String(url) : null;
            this.__ctvFiltered = undefined;
            return realOpen.apply(this, arguments);
        };
        for (const prop of ['responseText', 'response']) {
            const desc = Object.getOwnPropertyDescriptor(proto, prop);
            Object.defineProperty(proto, prop, {
                configurable: true,
                enumerable: desc.enumerable,
                get: function () {
                    const value = desc.get.call(this);
                    if (!this.__ctvPlaylistUrl || this.readyState !== 4 || typeof value !== 'string') return value;
                    if (this.__ctvFiltered === undefined) this.__ctvFiltered = filterPlaylist(this.__ctvPlaylistUrl, value);
                    return this.__ctvFiltered;
                },
            });
        }
    }

    function hookFetch(win) {
        const realFetch = win.fetch;
        win.fetch = function (input, init) {
            const url = typeof input === 'string' ? input : input && input.url;
            const pending = realFetch.apply(this, arguments);
            if (!isPlaylistUrl(url)) return pending;
            return pending.then(async (response) => {
                if (!response.ok) return response;
                const filtered = new Response(filterPlaylist(url, await response.text()), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers,
                });
                Object.defineProperty(filtered, 'url', { value: response.url });
                return filtered;
            });
        };
    }

    if (typeof window !== 'undefined' && window.top === window && !window.__ctvHlsAdblock) {
        window.__ctvHlsAdblock = true;
        hookXhr(window.XMLHttpRequest);
        hookFetch(window);
    }

    if (typeof module !== 'undefined') {
        module.exports = { stripAds, hasAdTags, isPlaylistUrl, filterPlaylist };
    }
})();
