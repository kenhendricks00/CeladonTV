const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createStallWatch, noticeText } = require(path.join(__dirname, '../../main/assets/scripts/celadontv-playback-guard.js'));

function run(watch, samples) {
    return samples.map((s) => watch.sample({ paused: false, ended: false, visible: true, adState: 'none', ...s }));
}

test('recovers a player stalled for 20 seconds outside an ad break', () => {
    const watch = createStallWatch({ lastRecover: -Infinity });
    const samples = [];
    for (let t = 0; t <= 10000; t += 1000) samples.push({ now: t, time: t / 1000 });
    for (let t = 11000; t <= 31000; t += 1000) samples.push({ now: t, time: 10 });
    const results = run(watch, samples);
    assert.equal(results.indexOf(true), samples.findIndex((s) => s.now === 30000), 'once 20s have passed without progress');
    assert.equal(results.filter(Boolean).length, 1);
});

test('never fights an ad break the filter is holding, a paused player or a hidden page', () => {
    for (const quiet of [{ adState: 'held' }, { paused: true }, { visible: false }, { ended: true }]) {
        const watch = createStallWatch({ lastRecover: -Infinity });
        const samples = [];
        for (let t = 0; t <= 120000; t += 1000) samples.push({ now: t, time: 5, ...quiet });
        assert.ok(run(watch, samples).every((r) => !r), JSON.stringify(quiet));
    }
});

test('a stall timer restarts when playback moves and recoveries are spaced out', () => {
    const watch = createStallWatch({ lastRecover: -Infinity, gapMs: 180000 });
    const samples = [];
    // Stalls of 15s separated by progress: never long enough.
    for (let t = 0; t < 60000; t += 1000) samples.push({ now: t, time: Math.floor(t / 15000) });
    assert.ok(run(watch, samples).every((r) => !r));
    // A long stall: one recovery, then none for 3 minutes even if it persists.
    const stuck = [];
    for (let t = 60000; t < 300000; t += 1000) stuck.push({ now: t, time: 99 });
    const results = run(watch, stuck);
    assert.equal(results.filter(Boolean).length, 2);
    const recoveries = stuck.filter((_, i) => results[i]).map((s) => s.now);
    assert.ok(recoveries[1] - recoveries[0] >= 180000);
});

test('a recovery from before a reload still counts towards the spacing', () => {
    const watch = createStallWatch({ lastRecover: 1000 });
    const samples = [];
    for (let t = 2000; t <= 60000; t += 1000) samples.push({ now: t, time: 3 });
    assert.ok(run(watch, samples).every((r) => !r));
});

test('the notice reads Blocking ads while the filter carries the player through a break', () => {
    assert.equal(noticeText('backup'), 'Blocking ads');
    assert.match(noticeText('held'), /^Blocking ads/);
    assert.equal(noticeText('ads'), null, 'ads that are playing are not being blocked');
    assert.equal(noticeText('none'), null);
});

// ---- The notice and the player's own controls -----------------------------------------

const { coversControls, isShownIn, install } = require(path.join(__dirname, '../../main/assets/scripts/celadontv-playback-guard.js'));

const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });

class FakeElement {
    constructor(tagName, box = rect(34, 24, 160, 55)) {
        this.tagName = tagName.toUpperCase();
        this.nodeType = 1;
        this.parentElement = null;
        this.children = [];
        this.style = {};
        this.computed = { display: 'block', visibility: 'visible', opacity: '1' };
        this.attributes = {};
        this.box = box;
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    append(...children) { children.forEach((c) => this.appendChild(c)); }
    get lastChild() { return this.children[this.children.length - 1]; }
    getBoundingClientRect() { return this.box; }
}

// A page shaped like Starshot's player: a controls layer, at opacity 0 until a key is
// pressed, with a "Go Back" button exactly where the notice sits, and chat elsewhere.
function fakePage() {
    const body = new FakeElement('body', rect(0, 0, 1920, 1080));
    const controls = body.appendChild(new FakeElement('div', rect(0, 0, 1440, 1080)));
    controls.computed.opacity = '0';
    const goBack = controls.appendChild(new FakeElement('button', rect(36, 27, 133, 59)));
    const chatLink = body.appendChild(new FakeElement('a', rect(1460, 20, 1900, 60)));
    let clock = 0;
    const timers = [];
    const listeners = {};
    const records = [];
    const win = {
        document: {
            body,
            visibilityState: 'visible',
            createElement: (tag) => new FakeElement(tag),
            querySelectorAll: () => [goBack, chatLink],
            querySelector: () => null,
        },
        getComputedStyle: (el) => el.computed,
        addEventListener: (type, fn) => (listeners[type] = listeners[type] || []).push(fn),
        setTimeout: (fn, ms) => timers.push({ fn, at: clock + ms, every: 0 }) - 1,
        setInterval: (fn, ms) => timers.push({ fn, at: clock + ms, every: ms }) - 1,
        clearTimeout: (id) => {
            if (timers[id]) timers[id].fn = null;
        },
        sessionStorage: { getItem: () => null, setItem: () => {} },
        location: { reload: () => records.push('RELOAD') },
        CeladonTVDiagnostics: { record: (line) => records.push(line) },
    };
    const realNow = Date.now;
    return {
        win,
        controls,
        chatLink,
        records,
        notice: () => body.children.find((c) => c.id === 'celadontv-ad-notice'),
        tick(ms) {
            const end = clock + ms;
            for (;;) {
                const next = timers.filter((t) => t.fn && t.at <= end).sort((a, b) => a.at - b.at)[0];
                if (!next) break;
                clock = next.at;
                Date.now = () => 1e12 + clock;
                const fn = next.fn;
                if (next.every) next.at += next.every;
                else next.fn = null;
                fn();
            }
            clock = end;
            Date.now = realNow;
        },
        emit(type, event) {
            (listeners[type] || []).forEach((fn) => fn(event));
        },
    };
}

const showing = (page) => {
    const n = page.notice();
    return !!n && n.style.visibility === 'visible' && n.style.opacity === '1';
};

test('the notice never covers the player controls: it steps aside while they show and comes back after', () => {
    const page = fakePage();
    install(page.win);
    page.emit('celadontv:adbreak', { detail: { state: 'backup' } });
    page.tick(0);
    assert.ok(showing(page), 'shown during a blocked break while the controls are hidden');

    // A key press brings Starshot's controls up; the Go Back button is under the notice.
    const keydown = {
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { throw new Error('must not stop key events'); },
    };
    page.controls.computed.opacity = '1';
    page.emit('keydown', keydown);
    page.tick(0);
    assert.ok(!showing(page), 'out of the way at once when the controls appear');
    assert.equal(page.notice().style.visibility, 'hidden');
    assert.equal(keydown.defaultPrevented, false, 'the key still reaches the player');

    // The controls fade out on their own; the notice returns within a check.
    page.controls.computed.opacity = '0.02';
    page.tick(200);
    assert.ok(showing(page), 'back once the controls are gone');

    // Controls showing without a key press are noticed too, even part-way through fading in.
    page.controls.computed.opacity = '0.6';
    page.tick(200);
    assert.ok(!showing(page), 'steps aside for partly faded-in controls');
    page.controls.computed.opacity = '0';
    page.tick(200);
    assert.ok(showing(page));

    // Interactive elements elsewhere (chat) never hide it.
    page.tick(1200);
    assert.ok(showing(page));

    // The break ends.
    page.emit('celadontv:adbreak', { detail: { state: 'none' } });
    page.tick(2000);
    assert.equal(page.notice().style.visibility, 'hidden');
    assert.ok(page.records.includes('notice: player controls showing, stepped aside'));
    assert.ok(!page.records.includes('RELOAD'));
});

test('the notice can never take focus or pointer input', () => {
    const page = fakePage();
    install(page.win);
    page.emit('celadontv:adbreak', { detail: { state: 'held' } });
    page.tick(0);
    const notice = page.notice();
    assert.equal(notice.getAttribute('tabindex'), null);
    assert.equal(notice.getAttribute('aria-hidden'), 'true');
    assert.equal(notice.inert, true);
    assert.match(notice.style.cssText, /pointer-events:none/);
});

test('only controls that overlap the notice and are actually showing count', () => {
    const noticeRect = rect(34, 24, 160, 55);
    const at = (box, opacity = '1') => ({ box, opacity });
    const rectOf = (c) => c.box;
    const shown = (c) => parseFloat(c.opacity) >= 0.05;
    assert.equal(coversControls(noticeRect, [at(rect(36, 27, 133, 59))], rectOf, shown), true);
    assert.equal(coversControls(noticeRect, [at(rect(36, 27, 133, 59), '0')], rectOf, shown), false, 'faded-out controls');
    assert.equal(coversControls(noticeRect, [at(rect(160, 24, 300, 55))], rectOf, shown), false, 'touching, not overlapping');
    assert.equal(coversControls(noticeRect, [at(rect(50, 30, 50, 30))], rectOf, shown), false, 'zero-sized');
});

test('a control is showing only if nothing it sits in is hidden or transparent', () => {
    const parent = { nodeType: 1, parentElement: null, s: { display: 'block', visibility: 'visible', opacity: '0.5' } };
    const child = { nodeType: 1, parentElement: parent, s: { display: 'block', visibility: 'visible', opacity: '0.5' } };
    const shown = isShownIn({ getComputedStyle: (e) => e.s });
    assert.equal(shown(child), true);
    parent.s.opacity = '0.08';
    assert.equal(shown(child), false, 'effective opacity 0.04');
    parent.s.opacity = '1';
    parent.s.visibility = 'hidden';
    assert.equal(shown(child), false);
    parent.s.visibility = 'visible';
    parent.s.display = 'none';
    assert.equal(shown(child), false);
});
