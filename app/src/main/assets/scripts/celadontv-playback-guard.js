// CeladonTV playback guard, injected with the ad filter (starshot-hls-adblock.js).
//
// - Shows a small "Blocking ads" notice in the top-left corner while the filter is
//   carrying the player through an ad break, and hides it when the break ends. It steps
//   aside (fades out) while any of the player's own controls show where it sits.
// - Backstop for a player that stops for good: if the video sits stalled for 20 seconds
//   outside a break the filter is knowingly holding, Twitch's page is reloaded, which
//   reopens the channel. At most once every 3 minutes.
(function () {
    'use strict';

    const STALL_LIMIT_MS = 20000;
    const RECOVER_GAP_MS = 180000;
    const CHECK_MS = 1000;
    const NOTICE_LINGER_MS = 1500;
    const BREAK_STALE_MS = 15000;
    const LAST_RECOVER_KEY = 'celadontv.lastRecover';
    const CONTROLS_CHECK_MS = 200;
    const CONTROLS_RESCAN_MS = 1000;
    const INTERACTIVE = 'a[href],button,input,select,textarea,[role="button"],[role="link"],[role="menuitem"],[tabindex]:not([tabindex="-1"])';

    function intersects(a, b) {
        return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    }

    // Whether the notice, at `noticeRect`, would sit on top of player controls that are on
    // screen. `controls` are the page's interactive elements; a control counts when its box
    // overlaps the notice and it is actually showing (Starshot keeps its player controls,
    // like the top-left "Go Back" button, in the page at opacity 0 while they are hidden).
    function coversControls(noticeRect, controls, rectOf, isShown) {
        return controls.some((el) => {
            const r = rectOf(el);
            return r.width > 0 && r.height > 0 && intersects(noticeRect, r) && isShown(el);
        });
    }

    // Effective visibility of an element: hidden if it, or anything it sits in, is not
    // displayed, is hidden, or is (nearly) transparent.
    function isShownIn(win) {
        return (el) => {
            let opacity = 1;
            for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
                const style = win.getComputedStyle(e);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
                opacity *= parseFloat(style.opacity);
                if (opacity < 0.05) return false;
            }
            return true;
        };
    }

    // Decides, one sample at a time, when a stalled player should be recovered.
    // `adState` is the filter's latest report: while it is holding the last live frame
    // through a break ('held'), a still picture is expected and never counts as a stall.
    function createStallWatch({ limitMs = STALL_LIMIT_MS, gapMs = RECOVER_GAP_MS, lastRecover = 0 } = {}) {
        let stalledSince = null;
        let lastTime = null;
        return {
            get lastRecover() {
                return lastRecover;
            },
            sample({ now, time, paused, ended, visible, adState }) {
                const watching = typeof time === 'number' && !paused && !ended && visible && adState !== 'held';
                if (!watching || lastTime === null || Math.abs(time - lastTime) > 0.1) {
                    stalledSince = watching ? now : null;
                    lastTime = typeof time === 'number' ? time : null;
                    return false;
                }
                if (stalledSince === null) stalledSince = now;
                if (now - stalledSince < limitMs || now - lastRecover < gapMs) return false;
                lastRecover = now;
                stalledSince = now;
                return true;
            },
        };
    }

    // What the notice says for a report from the filter, or null to hide it.
    function noticeText(adState) {
        if (adState === 'backup') return 'Blocking ads';
        if (adState === 'held') return 'Blocking ads · back after the break';
        return null;
    }

    function install(win) {
        const doc = win.document;
        let adState = 'none';
        let adStateAt = 0;
        let notice = null;
        let hideTimer = null;
        let wanted = false;
        let covered = false;
        let candidates = [];
        let candidatesAt = 0;
        const isShown = isShownIn(win);

        function record(line) {
            if (win.CeladonTVDiagnostics) {
                try {
                    win.CeladonTVDiagnostics.record(line);
                } catch (e) { /* best effort */ }
            }
        }

        function ensureNotice() {
            if (notice || !doc.body) return notice;
            notice = doc.createElement('div');
            notice.id = 'celadontv-ad-notice';
            // Decoration only: never focusable, never in the way of the remote or a pointer.
            notice.setAttribute('aria-hidden', 'true');
            notice.inert = true;
            notice.style.cssText = [
                'position:fixed', 'top:4.5vh', 'left:3.5vw', 'z-index:2147483647', 'pointer-events:none',
                'display:flex', 'align-items:center', 'gap:0.6em', 'padding:0.55em 1em',
                'background:rgba(14,14,16,0.88)', 'color:#EFEFF1', 'border-radius:0.5em',
                'box-shadow:0 2px 8px rgba(0,0,0,0.5)', 'font:600 1.4vw/1.2 Inter,Roobert,"Helvetica Neue",Arial,sans-serif',
                'opacity:0', 'transition:opacity 200ms ease', 'visibility:hidden',
            ].join(';');
            const dot = doc.createElement('span');
            dot.style.cssText = 'width:0.6em;height:0.6em;border-radius:50%;background:#9147FF;flex:none';
            const label = doc.createElement('span');
            label.className = 'celadontv-ad-notice-text';
            notice.append(dot, label);
            doc.body.appendChild(notice);
            return notice;
        }

        function render() {
            if (!notice) return;
            const visible = wanted && !covered;
            notice.style.opacity = visible ? '1' : '0';
            notice.style.visibility = visible ? 'visible' : 'hidden';
        }

        // Steps aside while the player's controls show where the notice sits.
        function checkControls() {
            if (!wanted || !notice) return;
            const now = Date.now();
            if (now - candidatesAt >= CONTROLS_RESCAN_MS) {
                const noticeRect = notice.getBoundingClientRect();
                candidates = Array.from(doc.querySelectorAll(INTERACTIVE)).filter((el) => intersects(noticeRect, el.getBoundingClientRect()));
                candidatesAt = now;
            }
            const nowCovered = coversControls(notice.getBoundingClientRect(), candidates, (el) => el.getBoundingClientRect(), isShown);
            if (nowCovered === covered) return;
            covered = nowCovered;
            record(covered ? 'notice: player controls showing, stepped aside' : 'notice: player controls gone, back');
            render();
        }

        function show(text) {
            win.clearTimeout(hideTimer);
            const el = ensureNotice();
            if (!el) return;
            el.lastChild.textContent = text;
            if (!wanted) record('notice shown: ' + text);
            wanted = true;
            candidatesAt = 0;
            checkControls();
            render();
        }

        function hide() {
            if (!wanted) return;
            wanted = false;
            covered = false;
            render();
            record('notice hidden');
        }

        win.setInterval(checkControls, CONTROLS_CHECK_MS);
        // The controls appear on a key press; check right away and as they fade in.
        win.addEventListener('keydown', () => {
            candidatesAt = 0;
            for (const delay of [0, 60, 150, 300]) win.setTimeout(checkControls, delay);
        }, true);

        win.addEventListener('celadontv:adbreak', (event) => {
            adState = (event.detail && event.detail.state) || 'none';
            adStateAt = Date.now();
            const text = noticeText(adState);
            if (text) show(text);
            else {
                win.clearTimeout(hideTimer);
                hideTimer = win.setTimeout(hide, NOTICE_LINGER_MS);
            }
        });

        let lastRecover = 0;
        try {
            lastRecover = Number(win.sessionStorage.getItem(LAST_RECOVER_KEY)) || 0;
        } catch (e) { /* storage unavailable */ }
        const watch = createStallWatch({ lastRecover });

        win.setInterval(() => {
            const now = Date.now();
            // Reports stop when the player is closed; a stale break no longer counts.
            if (adState !== 'none' && now - adStateAt > BREAK_STALE_MS) {
                adState = 'none';
                hide();
            }
            const video = doc.querySelector('video');
            const recover = watch.sample({
                now,
                time: video ? video.currentTime : undefined,
                paused: !video || video.paused,
                ended: !!video && video.ended,
                visible: doc.visibilityState === 'visible',
                adState,
            });
            if (!recover) return;
            try {
                win.sessionStorage.setItem(LAST_RECOVER_KEY, String(now));
            } catch (e) { /* storage unavailable */ }
            console.log('[CeladonTV] player stalled for 20s outside an ad break: reloading');
            record('recover: reloading after a 20s stall at ' + (video ? video.currentTime.toFixed(1) : '-'));
            win.location.reload();
        }, CHECK_MS);
    }

    if (typeof window !== 'undefined' && window.top === window && !window.__ctvPlaybackGuard) {
        window.__ctvPlaybackGuard = true;
        install(window);
    }

    if (typeof module !== 'undefined') {
        module.exports = { createStallWatch, noticeText, coversControls, isShownIn, install };
    }
})();
