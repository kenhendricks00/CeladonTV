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

    function hasAdTags(text) {
        return AD_SIGNIFIERS.some((s) => text.includes(s));
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

    // Keeps the contiguous run of live segments that follows any leading ads and
    // drops everything from the next ad onwards. Removing only from the ends keeps
    // every kept segment's media sequence number unchanged, which hls.js relies on.
    // `complete` is false when ads reach the live edge (nothing usable to append).
    function stripAds(playlist) {
        if (!hasAdTags(playlist)) return { playlist, removed: 0, complete: true };
        const { header, segments, trailer } = parse(playlist);
        let lead = 0;
        while (lead < segments.length && segments[lead].isAd) lead++;
        let end = lead;
        while (end < segments.length && !segments[end].isAd) end++;
        const kept = segments.slice(lead, end);
        const droppedDiscontinuities = segments
            .slice(0, lead)
            .reduce((n, s) => n + s.tags.filter((t) => t === '#EXT-X-DISCONTINUITY').length, 0);
        let newHeader = shiftHeader(header, 'EXT-X-MEDIA-SEQUENCE', lead);
        newHeader = shiftHeader(newHeader, 'EXT-X-DISCONTINUITY-SEQUENCE', droppedDiscontinuities);
        const lines = newHeader.slice();
        for (const s of kept) {
            lines.push(...s.tags.filter((t) => !hasAdTags(t)), s.uri);
        }
        const truncated = end < segments.length;
        lines.push(...trailer.filter((t) => !truncated || t.startsWith('#EXT-X-ENDLIST')));
        return {
            playlist: lines.join('\n') + '\n',
            removed: segments.length - kept.length,
            complete: kept.length > 0 && !truncated,
        };
    }

    function isPlaylistUrl(url) {
        return typeof url === 'string' && /\.m3u8(\?|$)/.test(url) && /^https:\/\/[^/]*\.(ttvnw\.net|twitch\.tv)\//.test(url);
    }

    // Playlist URL -> last playlist that reached the live edge. While ads occupy the
    // edge it is returned unchanged, so hls.js waits for new segments; a shrinking
    // trimmed window instead makes the player seek back and replay the last seconds.
    const lastLive = new Map();

    function filterPlaylist(url, text) {
        if (typeof text !== 'string' || !text.includes('#EXTINF')) return text;
        const result = stripAds(text);
        if (result.complete) {
            lastLive.set(url, result.playlist);
            if (result.removed > 0) console.log(LOG_PREFIX + ' removed ' + result.removed + ' ad segment(s)');
            return result.playlist;
        }
        console.log(LOG_PREFIX + ' ad break: holding last live playlist');
        return lastLive.get(url) || result.playlist;
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
