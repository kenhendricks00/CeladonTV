const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { ensureRow, findSettingsList, keyAction, revealShift, ROW_ATTR, TITLE, SUBTITLE } = require(
    path.join(__dirname, '../../main/assets/scripts/celadontv-settings-row.js'),
);

// Just enough DOM for the script: attribute/prefix/descendant selectors, cloning, text.
class El {
    constructor(tagName, attrs = {}, children = [], text = '') {
        this.tagName = tagName.toUpperCase();
        this.attrs = { ...attrs };
        this.children = [];
        this.parentElement = null;
        this.ownText = text;
        children.forEach((c) => this.appendChild(c));
    }
    get className() { return this.attrs.class || ''; }
    set className(v) { this.attrs.class = v; }
    get textContent() { return this.ownText + this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this.children = []; this.ownText = v; }
    getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
    setAttribute(n, v) { this.attrs[n] = String(v); }
    hasAttribute(n) { return n in this.attrs; }
    removeAttribute(n) { delete this.attrs[n]; }
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
    insertBefore(c, ref) { c.parentElement = this; this.children.splice(this.children.indexOf(ref), 0, c); return c; }
    contains(o) { for (let e = o; e; e = e.parentElement) if (e === this) return true; return false; }
    cloneNode() { return new El(this.tagName, this.attrs, this.children.map((c) => c.cloneNode()), this.ownText); }
    descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]); }
    matchesSimple(sel) {
        const m = sel.match(/^([a-z0-9*]*)(?:\[([\w-]+)(?:(\^?=)"([^"]*)")?\])?$/i);
        if (!m) throw new Error('unsupported selector ' + sel);
        const [, tag, attr, op, value] = m;
        if (tag && tag !== '*' && tag.toUpperCase() !== this.tagName) return false;
        if (!attr) return true;
        if (!this.hasAttribute(attr)) return false;
        if (op === '^=') return this.attrs[attr].startsWith(value);
        if (op === '=') return this.attrs[attr] === value;
        return true;
    }
    matches(selector, scope) {
        const parts = selector.trim().split(/\s+/);
        if (!this.matchesSimple(parts.pop())) return false;
        let e = this.parentElement;
        while (parts.length) {
            while (e && e !== scope.parentElement && !e.matchesSimple(parts[parts.length - 1])) e = e.parentElement;
            if (!e || e === scope.parentElement) return false;
            parts.pop();
            e = e.parentElement;
        }
        return true;
    }
    querySelectorAll(sel) { return this.descendants().filter((d) => d.matches(sel, this)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function row(label, section) {
    return new El('div', { class: 'item' }, [
        new El('a', { href: '/settings/' + section, 'aria-label': label, class: 'row' }, [
            new El('div', { class: 'icon' }, [
                new El('div', { class: 'outline' }, [new El('svg', {}, [new El('path', { d: 'M0 0' })])]),
                new El('div', { class: 'accent' }, [new El('svg', {}, [new El('path', { d: 'M0 0' })])]),
            ]),
            new El('h2', {}, [], label),
            new El('p', {}, [], 'About ' + label),
        ]),
    ]);
}

function settingsPage() {
    const list = new El('div', { class: 'list' }, [row('Your Profile', 'profile'), row('Need Help?', 'help'), row('Cookies', 'security')]);
    const body = new El('body', {}, [new El('main', {}, [new El('a', { href: '/' }, [], 'Go Back'), list])]);
    const doc = new El('html', {}, [body]);
    doc.activeElement = list.querySelector('a[href^="/settings/"]');
    return { doc, list };
}

test('does nothing when the settings list is missing', () => {
    const doc = new El('html', {}, [new El('body', {}, [new El('a', { href: '/directory' }, [], 'Browse')])]);
    const before = JSON.stringify(doc.descendants().map((d) => [d.tagName, d.attrs]));
    assert.equal(ensureRow(doc), null);
    assert.equal(findSettingsList(doc), null);
    assert.equal(JSON.stringify(doc.descendants().map((d) => [d.tagName, d.attrs])), before);
});

test('ignores pages with a single settings link', () => {
    const doc = new El('html', {}, [new El('body', {}, [row('Your Profile', 'profile')])]);
    assert.equal(ensureRow(doc), null);
});

test('inserts one CeladonTV row above the first Twitch row, as a sibling item', () => {
    const { doc, list } = settingsPage();
    const { link, created } = ensureRow(doc);
    const items = list.children;
    assert.equal(created, true);
    assert.equal(items.length, 4);
    assert.ok(items[0].hasAttribute(ROW_ATTR));
    assert.equal(items[0].parentElement, list);
    assert.equal(items[1].querySelector('a').getAttribute('aria-label'), 'Your Profile');
    assert.equal(link.getAttribute('aria-label'), TITLE);
    assert.equal(link.getAttribute('href'), null);
    assert.equal(link.querySelector('h2').textContent, TITLE);
    assert.equal(link.querySelector('p').textContent, SUBTITLE);
    const paths = link.querySelectorAll('svg path').map((p) => p.getAttribute('d'));
    assert.equal(paths.length, 2);
    assert.ok(paths.every((d) => d === paths[0] && d !== 'M0 0'), 'outline and accent layers both get the CeladonTV icon');
    assert.equal(link.className, 'row');
});

test('clones an unfocused row so the new row starts unfocused', () => {
    const { doc, list } = settingsPage();
    list.children[0].querySelector('a').className = 'row focused';
    const { link } = ensureRow(doc);
    assert.equal(link.className, 'row');
});

test('is idempotent across repeated mutations', () => {
    const { doc, list } = settingsPage();
    const first = ensureRow(doc);
    const second = ensureRow(doc);
    assert.equal(first.link, second.link);
    assert.equal(second.created, false);
    assert.equal(list.querySelectorAll('[' + ROW_ATTR + ']').length, 1);
    assert.ok(findSettingsList(doc), 'the added row must not hide the list');
});

test('leaves Twitch rows untouched', () => {
    const { doc, list } = settingsPage();
    ensureRow(doc);
    assert.deepEqual(
        list.querySelectorAll('a[href^="/settings/"]').map((a) => a.getAttribute('aria-label')),
        ['Your Profile', 'Need Help?', 'Cookies'],
    );
});

test('maps remote keys to row actions only around the CeladonTV row', () => {
    assert.equal(keyAction('ArrowUp', 'firstRow'), 'enter');
    assert.equal(keyAction('ArrowDown', 'firstRow'), null);
    assert.equal(keyAction('Enter', 'firstRow'), null);
    assert.equal(keyAction('ArrowDown', 'ourRow'), 'leave');
    assert.equal(keyAction('Escape', 'ourRow'), 'leave');
    assert.equal(keyAction('ArrowUp', 'ourRow'), 'leaveUp');
    assert.equal(keyAction('Enter', 'ourRow'), 'open');
    assert.equal(keyAction('ArrowRight', 'ourRow'), 'swallow');
    assert.equal(keyAction('ArrowLeft', 'ourRow'), 'swallow');
    assert.equal(keyAction('MediaPlayPause', 'ourRow'), null);
    assert.equal(keyAction('ArrowDown', 'other'), null);
    assert.equal(keyAction('Enter', 'other'), null);
});

test('shifts the fixed list just enough to keep the focused row on screen', () => {
    const rowAt = (top, shift = 0) => ({ top: top - shift, bottom: top + 76 - shift });
    assert.equal(revealShift(0, rowAt(131), 131, 532), 0, 'top row needs no shift');
    assert.equal(revealShift(0, rowAt(511), 131, 532), 55, 'bottom row below the edge shifts up');
    assert.equal(revealShift(55, rowAt(435, 55), 131, 532), 55, 'a visible row keeps the current shift');
    assert.equal(revealShift(55, rowAt(131, 55), 131, 532), 0, 'returning to the top row undoes the shift');
});
