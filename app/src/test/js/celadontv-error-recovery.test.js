const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { errorScreenOf, install } = require(path.join(__dirname, '../../main/assets/scripts/celadontv-error-recovery.js'));

// Just enough DOM: tags, attributes, parents, and the two selectors the script uses.
class El {
    constructor(tagName, attrs = {}, children = []) {
        this.tagName = tagName.toUpperCase();
        this.attrs = attrs;
        this.parentElement = null;
        this.children = children;
        children.forEach((c) => { c.parentElement = this; });
    }
    descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]); }
    matches(selector) {
        if (selector === 'img[src*="error-500"]') return this.tagName === 'IMG' && (this.attrs.src || '').includes('error-500');
        if (selector === 'a[href]') return this.tagName === 'A' && 'href' in this.attrs;
        if (selector === 'button') return this.tagName === 'BUTTON';
        throw new Error('unsupported selector ' + selector);
    }
    querySelector(selector) { return this.descendants().find((d) => d.matches(selector)) || null; }
    closest(selector) {
        for (let e = this; e; e = e.parentElement) if (e.matches(selector)) return e;
        return null;
    }
}

// Starshot's error page as it renders on the TV: the top nav (links), then the error
// screen with its message, Reload button and picture.
function errorPage({ withPicture = true } = {}) {
    const label = new El('div');
    const reload = new El('button', { 'aria-label': 'Reload' }, [new El('div', {}, [label])]);
    const following = new El('a', { href: '/following' });
    const gear = new El('button', { 'aria-label': 'Settings' });
    const screen = new El('div', {}, [
        new El('div', {}, [new El('h3'), new El('div', {}, [reload])]),
        ...(withPicture ? [new El('div', {}, [new El('img', { src: 'static/starshot/images/error-500.png' })])] : []),
    ]);
    const body = new El('body', {}, [new El('nav', {}, [following, gear]), screen]);
    return { body, reload, label, following, gear, screen };
}

test('finds the error screen from its Reload button', () => {
    const page = errorPage();
    assert.equal(errorScreenOf(page.reload), page.screen);
});

test('ignores the top nav and any other screen', () => {
    const page = errorPage();
    assert.equal(errorScreenOf(page.following), null, 'nav links');
    assert.equal(errorScreenOf(page.gear), null, 'a nav button: its nearest picture holder has the nav links');
    assert.equal(errorScreenOf(errorPage({ withPicture: false }).reload), null, 'a button on a screen without the error picture');
    assert.equal(errorScreenOf(null), null);
});

function fakeWindow(active) {
    const listeners = {};
    const win = {
        document: { activeElement: active },
        location: { replaced: null, replace(url) { this.replaced = url; } },
        addEventListener: (type, fn, capture) => {
            assert.equal(capture, true, 'listens in the capture phase, ahead of Starshot');
            listeners[type] = fn;
        },
    };
    const fire = (type, init) => {
        const event = { ...init, stopped: false, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
        listeners[type](event);
        return event;
    };
    return { win, fire };
}

test('OK on Reload opens the home screen instead of reloading the page', () => {
    const page = errorPage();
    const { win, fire } = fakeWindow(page.reload);
    install(win, 'https://celadon.tv.twitch.tv/');
    const event = fire('keydown', { key: 'Enter', keyCode: 13 });
    assert.equal(win.location.replaced, 'https://celadon.tv.twitch.tv/');
    assert.ok(event.stopped && event.prevented, 'Starshot\'s own reload never runs');
});

test('clicking Reload (or its label) does the same', () => {
    const page = errorPage();
    const { win, fire } = fakeWindow(null);
    install(win, 'https://celadon.tv.twitch.tv/');
    fire('click', { target: page.label });
    assert.equal(win.location.replaced, 'https://celadon.tv.twitch.tv/');
});

test('every other key and button is left to Starshot', () => {
    const page = errorPage();
    for (const [active, init] of [[page.following, { key: 'Enter', keyCode: 13 }], [page.reload, { key: 'ArrowUp', keyCode: 38 }], [page.gear, { key: 'Enter', keyCode: 13 }]]) {
        const { win, fire } = fakeWindow(active);
        install(win, 'https://celadon.tv.twitch.tv/');
        const event = fire('keydown', init);
        assert.equal(win.location.replaced, null);
        assert.ok(!event.stopped && !event.prevented);
    }
    const { win, fire } = fakeWindow(null);
    install(win, 'https://celadon.tv.twitch.tv/');
    fire('click', { target: page.following });
    assert.equal(win.location.replaced, null);
});
