// Adds a "CeladonTV" row as the first entry of Twitch's TV settings page (/settings).
//
// The row is a clone of one of Twitch's own rows, so it inherits their layout,
// typography, icon treatment and focus styling. Starshot's focus manager doesn't know
// about it, so the remote keys that enter and leave it are handled here; Twitch's own
// focus state stays on its first row the whole time.
(function () {
    'use strict';

    const ROW_ATTR = 'data-celadontv-row';
    const TITLE = 'CeladonTV';
    const SUBTITLE = 'Ad blocking, script updates and app updates';
    const BOTTOM_MARGIN = 8;
    // Starshot focuses its first row again shortly after the page mounts.
    const INITIAL_FOCUS_WINDOW_MS = 1500;
    const ICON_PATH = 'M3.5 5h13A1.5 1.5 0 0 1 18 6.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 15.5v-9A1.5 1.5 0 0 1 3.5 5zM4 7v8h12V7H4zm4.5 1.75L12.5 11l-4 2.25v-4.5zM6.2 1.6l3.3 3.1-1 .9-3.3-3.1 1-.9zm7.6 0 1 .9-3.3 3.1-1-.9 3.3-3.1z';

    // Twitch's settings rows are links to /settings/<section>, one per list item.
    function findSettingsList(doc) {
        const rows = Array.from(doc.querySelectorAll('a[href^="/settings/"]'));
        if (rows.length < 2) return null;
        let list = rows[0].parentElement;
        while (list && !rows.every((r) => list.contains(r))) list = list.parentElement;
        if (!list) return null;
        const items = Array.from(list.children).filter((item) => !item.hasAttribute(ROW_ATTR));
        if (items.length !== rows.length || !items.every((item, i) => item.contains(rows[i]))) return null;
        return { list, rows, items };
    }

    function elements(root) {
        return [root].concat(Array.from(root.querySelectorAll('*')));
    }

    function classesOf(root) {
        return elements(root).map((el) => (typeof el.className === 'string' ? el.className : null));
    }

    // Copies Twitch's focused or unfocused classes position by position; SVG nodes are left alone.
    function applyClasses(root, classes) {
        elements(root).forEach((el, i) => {
            if (typeof el.className === 'string' && typeof classes[i] === 'string') el.className = classes[i];
        });
    }

    function buildRow(template) {
        const item = template.cloneNode(true);
        item.setAttribute(ROW_ATTR, '');
        const link = item.querySelector('a[href^="/settings/"]');
        link.removeAttribute('href');
        link.setAttribute('aria-label', TITLE);
        link.setAttribute('tabindex', '-1');
        const texts = elements(link).filter((el) => el.children.length === 0 && el.textContent.trim() !== '');
        if (texts[0]) texts[0].textContent = TITLE;
        if (texts[1]) texts[1].textContent = SUBTITLE;
        // Twitch stacks the same path twice (outline plus offset accent); replace both.
        link.querySelectorAll('svg path').forEach((path) => path.setAttribute('d', ICON_PATH));
        return item;
    }

    /** Inserts the row once, above Twitch's first row. Returns { link, created }, or null if there is no list. */
    function ensureRow(doc) {
        const found = findSettingsList(doc);
        if (!found) return null;
        const existing = found.list.querySelector('[' + ROW_ATTR + '] a');
        if (existing) return { link: existing, created: false };
        const focused = doc.activeElement;
        const template = found.items.find((item) => !item.contains(focused)) || found.items[found.items.length - 1];
        const item = buildRow(template);
        found.list.insertBefore(item, found.items[0]);
        return { link: item.querySelector('a'), created: true };
    }

    /** What a key press means, given where focus is: 'enter' | 'leave' | 'leaveUp' | 'open' | 'swallow' | null. */
    function keyAction(key, focus) {
        if (focus === 'firstRow') return key === 'ArrowUp' ? 'enter' : null;
        if (focus !== 'ourRow') return null;
        if (key === 'ArrowDown' || key === 'Escape') return 'leave';
        if (key === 'ArrowUp') return 'leaveUp';
        if (key === 'Enter') return 'open';
        if (key === 'ArrowLeft' || key === 'ArrowRight') return 'swallow';
        return null;
    }

    /** How far to shift a fixed list up (px) so `rect` (measured at the current shift) is fully visible. */
    function revealShift(current, rect, listTop, viewportBottom) {
        const top = rect.top + current;
        const bottom = rect.bottom + current;
        const min = Math.max(0, bottom - viewportBottom);
        const max = Math.max(0, top - listTop);
        return Math.min(Math.max(current, min), max);
    }

    function install(win) {
        const doc = win.document;
        let active = null;
        let enterOnFirstRowFocus = false;
        let initialFocusUntil = 0;
        // Twitch's list is position: fixed, so it is shifted (not scrolled) to keep the focused row visible.
        let shift = null;

        function current() {
            const found = findSettingsList(doc);
            const ourLink = found && found.list.querySelector('[' + ROW_ATTR + '] a');
            return ourLink ? { found, ourLink } : null;
        }

        function reveal(found, el) {
            const now = shift ? shift.px : 0;
            const listTop = found.list.getBoundingClientRect().top + now;
            const px = revealShift(now, el.getBoundingClientRect(), listTop, win.innerHeight - BOTTOM_MARGIN);
            if (px === now) return;
            if (!shift) shift = { list: found.list, transform: found.list.style.transform, px: 0 };
            shift.px = px;
            found.list.style.transform = px ? 'translateY(' + -px + 'px)' : shift.transform;
            if (!px) shift = null;
        }

        // While the CeladonTV row has focus, Twitch still believes its first row does and keeps
        // updating that row's classes (the focus fill lands after the ring). Mirror whatever
        // Twitch intends onto the CeladonTV row and keep its first row looking unfocused.
        function paint() {
            const { firstRow, ourLink, intended, unfocused, observer } = active;
            observer.disconnect();
            applyClasses(ourLink, intended);
            applyClasses(firstRow, unfocused);
            observer.observe(firstRow, { attributes: true, attributeFilter: ['class'], subtree: true });
        }

        function enter(found, ourLink) {
            const firstRow = found.rows[0];
            const intended = classesOf(firstRow);
            const observer = new win.MutationObserver((records) => {
                if (!active || active.firstRow !== firstRow) return;
                const nodes = elements(firstRow);
                records.forEach((record) => {
                    const i = nodes.indexOf(record.target);
                    if (i >= 0 && typeof record.target.className === 'string') intended[i] = record.target.className;
                });
                paint();
            });
            active = { firstRow, ourLink, intended, unfocused: classesOf(found.rows[1]), observer };
            paint();
            ourLink.focus({ preventScroll: true });
            reveal(found, ourLink);
        }

        function release() {
            const state = active;
            active = null;
            state.observer.disconnect();
            applyClasses(state.ourLink, state.unfocused);
            applyClasses(state.firstRow, state.intended);
            return state;
        }

        function openSettings() {
            const bridge = win.CeladonTVNative;
            if (bridge && typeof bridge.openSettings === 'function') bridge.openSettings();
        }

        win.addEventListener('keydown', (event) => {
            try {
                const page = current();
                if (!page) return;
                const { found, ourLink } = page;
                const focused = doc.activeElement;
                const focus = active && focused === ourLink ? 'ourRow' : focused === found.rows[0] ? 'firstRow' : 'other';
                if (focus === 'other' && event.key === 'ArrowDown' && !found.list.contains(focused)) enterOnFirstRowFocus = true;
                const action = keyAction(event.key, focus);
                if (!action) return;
                if (action === 'enter') {
                    enter(found, ourLink);
                } else if (action === 'leave') {
                    release().firstRow.focus({ preventScroll: true });
                    if (event.key === 'Escape') return;
                } else if (action === 'leaveUp') {
                    release().firstRow.focus({ preventScroll: true });
                    return;
                } else if (action === 'open') {
                    openSettings();
                }
                event.preventDefault();
                event.stopImmediatePropagation();
            } catch (e) {
                active = null;
            }
        }, true);

        doc.addEventListener('focusin', (event) => {
            try {
                const page = current();
                if (!page) return;
                const { found, ourLink } = page;
                if (active && event.target !== ourLink) release();
                if (event.target === found.rows[0] && (enterOnFirstRowFocus || Date.now() < initialFocusUntil)) {
                    enterOnFirstRowFocus = false;
                    enter(found, ourLink);
                    return;
                }
                if (event.target !== ourLink) enterOnFirstRowFocus = false;
                if (found.list.contains(event.target)) reveal(found, event.target);
            } catch (e) {
                active = null;
            }
        }, true);

        let scheduled = false;
        function schedule() {
            if (scheduled) return;
            scheduled = true;
            win.requestAnimationFrame(() => {
                scheduled = false;
                try {
                    const row = ensureRow(doc);
                    if (!row || !row.created) return;
                    active = null;
                    shift = null;
                    row.link.addEventListener('click', openSettings);
                    initialFocusUntil = Date.now() + INITIAL_FOCUS_WINDOW_MS;
                    const found = findSettingsList(doc);
                    if (doc.activeElement === found.rows[0]) enter(found, row.link);
                    else enterOnFirstRowFocus = true;
                } catch (e) {
                    // Never interfere with Twitch's page if its markup changes.
                }
            });
        }
        new win.MutationObserver(schedule).observe(doc.documentElement, { childList: true, subtree: true });
        schedule();
    }

    if (typeof window !== 'undefined' && window.top === window && !window.__ctvSettingsRow) {
        window.__ctvSettingsRow = true;
        install(window);
    }

    if (typeof module !== 'undefined') {
        module.exports = { ensureRow, findSettingsList, keyAction, revealShift, ROW_ATTR, TITLE, SUBTITLE };
    }
})();
