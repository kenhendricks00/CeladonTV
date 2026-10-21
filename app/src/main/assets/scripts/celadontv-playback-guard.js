// CeladonTV playback guard, injected with the ad filter (starshot-hls-adblock.js).
//
// - Shows a small "Blocking ads" notice in the top-left corner while the filter is
//   carrying the full-screen player through an ad break. It is only ever drawn over the
//   bare video: never outside the player (home, browse, settings) and never while any of
//   the player's own controls are up, and it is cleared as soon as the player goes away.
// - Backstops for a player that stops for good: a video stalled for 20 seconds outside a
//   break the filter is knowingly holding, or Twitch's "An error occurred while playing
//   this content" screen, reloads Twitch's page, which reopens the channel. Recoveries
//   share a budget (3 in 10 minutes, at least 20 seconds apart) so they can never loop.
(function () {
    'use strict';

    const STALL_LIMIT_MS = 20000;
    const RECOVER_GAP_MS = 180000;
    const CHECK_MS = 1000;
    const NOTICE_LINGER_MS = 1500;
    const BREAK_STALE_MS = 15000;
    const ERROR_SCREEN_MS = 3000;
    const RECOVERY_KEY = 'celadontv.recoveries';
    const PLACEMENT_CHECK_MS = 200;
    const CANDIDATES_RESCAN_MS = 1000;
    const PLAYER_MIN_SHARE = 0.6;
    const INTERACTIVE = 'a[href],button,input,select,textarea,[role="button"],[role="link"],[role="menuitem"],[tabindex]:not([tabindex="-1"])';
    const ERROR_SCREEN = /error occurred while playing/i;

    function intersects(a, b) {
        return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    }

    // Whether any of `controls` (the page's interactive elements) is showing over `area`.
    // Starshot keeps its player controls in the page at opacity 0 while they are hidden and
    // fades them in on a key press, so only controls that are actually visible count.
    function coversControls(area, controls, rectOf, isShown) {
        return controls.some((el) => {
            const r = rectOf(el);
            return r.width > 0 && r.height > 0 && intersects(area, r) && isShown(el);
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

    // The full-screen player's video: the largest visible video covering most of the screen
    // (the TV player fills it; with chat open it still takes about three quarters of it).
    // Previews and thumbnails elsewhere in Twitch's UI never qualify.
    function findPlayer(videos, viewport, rectOf, isShown) {
        let best = null;
        for (const video of videos) {
            const r = rectOf(video);
            if (r.width < viewport.width * PLAYER_MIN_SHARE || r.height < viewport.height * PLAYER_MIN_SHARE || !isShown(video)) continue;
            if (!best || r.width * r.height > best.rect.width * best.rect.height) best = { video, rect: r };
        }
        return best;
    }

    // Whether the notice belongs on screen right now.
    function noticeVisible({ adState, player, uiShown }) {
        return noticeText(adState) !== null && !!player && !uiShown;
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

    // How many automatic recoveries are allowed: at most `max` in `windowMs`, at least
    // `minGapMs` apart. `history` (recovery times) survives the page reloads it causes.
    function createRecoveryBudget({ max = 3, windowMs = 10 * 60000, minGapMs = 20000, history = [] } = {}) {
        let times = history.slice();
        return {
            get history() {
                return times.slice();
            },
            take(now) {
                times = times.filter((t) => now - t < windowMs);
                if (times.length >= max || (times.length && now - times[times.length - 1] < minGapMs)) return false;
                times.push(now);
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
        const isShown = isShownIn(win);
        let adState = 'none';
        let adStateAt = 0;
        let notice = null;
        let lingerTimer = null;
        let candidates = [];
        let candidatesAt = 0;
        let lastShown = false;
        let errorSince = null;

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
            // Decoration only: never focusable, hoverable or announced, and never in the way
            // of the remote or a pointer.
            notice.setAttribute('aria-hidden', 'true');
            notice.setAttribute('tabindex', '-1');
            notice.inert = true;
            notice.style.cssText = [
                'position:fixed', 'top:4.5vh', 'left:3.5vw', 'z-index:2147483647', 'pointer-events:none',
                'user-select:none', 'outline:none', 'display:flex', 'align-items:center', 'gap:0.6em',
                'padding:0.55em 1em', 'background:rgba(14,14,16,0.88)', 'color:#EFEFF1', 'border-radius:0.5em',
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

        function viewport() {
            return { width: win.innerWidth, height: win.innerHeight };
        }

        function currentPlayer() {
            return findPlayer(Array.from(doc.querySelectorAll('video')), viewport(), (el) => el.getBoundingClientRect(), isShown);
        }

        function endBreak(reason) {
            if (adState === 'none') return;
            adState = 'none';
            win.__ctvAdBreak = { state: 'none', at: Date.now() };
            record('break state cleared: ' + reason);
        }

        // Shows the notice only over the bare full-screen player during a blocked break.
        function place() {
            const player = currentPlayer();
            if (!player && adState !== 'none') endBreak('the player closed');
            let uiShown = false;
            if (player && noticeText(adState)) {
                const now = Date.now();
                if (now - candidatesAt >= CANDIDATES_RESCAN_MS) {
                    candidates = Array.from(doc.querySelectorAll(INTERACTIVE)).filter((el) => el !== notice && intersects(player.rect, el.getBoundingClientRect()));
                    candidatesAt = now;
                }
                uiShown = coversControls(player.rect, candidates, (el) => el.getBoundingClientRect(), isShown);
            }
            const shown = noticeVisible({ adState, player, uiShown });
            if (shown && !ensureNotice()) return;
            if (notice) {
                notice.lastChild.textContent = noticeText(adState) || notice.lastChild.textContent;
                notice.style.opacity = shown ? '1' : '0';
                notice.style.visibility = shown ? 'visible' : 'hidden';
            }
            if (shown !== lastShown) {
                record(shown ? 'notice shown: ' + noticeText(adState) : 'notice hidden' + (uiShown ? ' (player controls up)' : !player ? ' (no full-screen player)' : ''));
                lastShown = shown;
            }
        }

        win.setInterval(place, PLACEMENT_CHECK_MS);
        // The controls appear on a key press; check right away and as they fade in. This only
        // observes the key: it is neither consumed nor stopped.
        win.addEventListener('keydown', () => {
            candidatesAt = 0;
            for (const delay of [0, 60, 150, 300]) win.setTimeout(place, delay);
        }, true);

        win.addEventListener('celadontv:adbreak', (event) => {
            const state = (event.detail && event.detail.state) || 'none';
            adStateAt = Date.now();
            win.clearTimeout(lingerTimer);
            if (noticeText(state)) {
                adState = state;
                place();
            } else {
                // A short linger keeps a break that ends and restarts from flickering.
                lingerTimer = win.setTimeout(() => {
                    endBreak('the break ended');
                    place();
                }, NOTICE_LINGER_MS);
            }
        });

        let history = [];
        try {
            history = JSON.parse(win.sessionStorage.getItem(RECOVERY_KEY) || '[]');
        } catch (e) { /* storage unavailable */ }
        const budget = createRecoveryBudget({ history });
        const watch = createStallWatch({ lastRecover: history.length ? history[history.length - 1] : 0 });

        function recover(why) {
            const now = Date.now();
            if (!budget.take(now)) {
                record('recover held back (at most 3 in 10 minutes, 20s apart): ' + why);
                return false;
            }
            try {
                win.sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(budget.history));
            } catch (e) { /* storage unavailable */ }
            console.log('[CeladonTV] ' + why + ': reopening the channel');
            record('recover: ' + why);
            win.location.reload();
            return true;
        }

        win.setInterval(() => {
            const now = Date.now();
            // Reports stop when the player stops loading playlists; a stale break no longer counts.
            if (adState !== 'none' && now - adStateAt > BREAK_STALE_MS) {
                endBreak('no playlist reports');
                place();
            }
            const video = doc.querySelector('video');
            // Twitch's error screen replaces the player; reopen the channel once it has stayed up.
            const notPlaying = !video || video.paused || video.ended || video.readyState < 2;
            if (notPlaying && doc.body && ERROR_SCREEN.test(doc.body.innerText || '')) {
                if (errorSince === null) {
                    errorSince = now;
                    record('Twitch error screen shown');
                } else if (now - errorSince >= ERROR_SCREEN_MS && recover('Twitch showed its playback error screen')) return;
            } else errorSince = null;
            const stalled = watch.sample({
                now,
                time: video ? video.currentTime : undefined,
                paused: !video || video.paused,
                ended: !!video && video.ended,
                visible: doc.visibilityState === 'visible',
                adState,
            });
            if (stalled) recover('player stalled for 20s outside an ad break at ' + video.currentTime.toFixed(1));
        }, CHECK_MS);
    }

    if (typeof window !== 'undefined' && window.top === window && !window.__ctvPlaybackGuard) {
        window.__ctvPlaybackGuard = true;
        install(window);
    }

    if (typeof module !== 'undefined') {
        module.exports = { createStallWatch, createRecoveryBudget, noticeText, noticeVisible, findPlayer, coversControls, isShownIn, install };
    }
})();
