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


// ---- The notice, the player and the backstops ------------------------------------------

const { coversControls, isShownIn, install, findPlayer, noticeVisible, createRecoveryBudget } = require(path.join(__dirname, '../../main/assets/scripts/celadontv-playback-guard.js'));

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
        this.currentTime = 0;
        this.paused = false;
        this.ended = false;
        this.readyState = 4;
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentElement = null; }
    append(...children) { children.forEach((c) => this.appendChild(c)); }
    get lastChild() { return this.children[this.children.length - 1]; }
    getBoundingClientRect() { return this.box; }
}

// Shaped like Starshot on the TV (960x540 CSS px): a full-screen player whose controls
// layer sits at opacity 0 until a key is pressed (Go Back top-left, Follow bottom-right),
// or the home screen, with its own nav links and no video at all.
function fakeTv() {
    const body = new FakeElement('body', rect(0, 0, 960, 540));
    body.innerText = '';
    const video = new FakeElement('video', rect(0, 0, 960, 540));
    const controls = new FakeElement('div', rect(0, 0, 960, 540));
    controls.computed.opacity = '0';
    const goBack = controls.appendChild(new FakeElement('button', rect(36, 27, 133, 59)));
    const follow = controls.appendChild(new FakeElement('button', rect(830, 420, 915, 452)));
    const homeLogo = new FakeElement('a', rect(80, 45, 110, 80));
    let clock = 0;
    const timers = [];
    const listeners = {};
    const records = [];
    const storage = {};
    const win = {
        innerWidth: 960,
        innerHeight: 540,
        document: {
            body,
            visibilityState: 'visible',
            createElement: (tag) => new FakeElement(tag),
            querySelectorAll: (selector) => {
                const all = body.children.flatMap((c) => [c, ...c.children]);
                if (selector === 'video') return all.filter((e) => e.tagName === 'VIDEO');
                return all.filter((e) => e.tagName === 'BUTTON' || e.tagName === 'A');
            },
            querySelector: (selector) => win.document.querySelectorAll(selector)[0] || null,
        },
        getComputedStyle: (el) => el.computed,
        addEventListener: (type, fn) => (listeners[type] = listeners[type] || []).push(fn),
        dispatchEvent: () => true,
        setTimeout: (fn, ms) => timers.push({ fn, at: clock + ms, every: 0 }) - 1,
        setInterval: (fn, ms) => timers.push({ fn, at: clock + ms, every: ms }) - 1,
        clearTimeout: (id) => {
            if (timers[id]) timers[id].fn = null;
        },
        sessionStorage: { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
        location: { reload: () => records.push('RELOAD') },
        CeladonTVDiagnostics: { record: (line) => records.push(line) },
    };
    const realNow = Date.now;
    // Everything the page sees happens on the fake clock.
    const onClock = (fn) => {
        Date.now = () => 1e12 + clock;
        try {
            fn();
        } finally {
            Date.now = realNow;
        }
    };
    const tv = {
        win,
        video,
        controls,
        records,
        storage,
        notice: () => body.children.find((c) => c.id === 'celadontv-ad-notice'),
        showing() {
            const n = tv.notice();
            return !!n && n.style.visibility === 'visible' && n.style.opacity === '1';
        },
        openPlayer() {
            body.appendChild(video);
            body.appendChild(controls);
            body.removeChild(homeLogo);
        },
        goHome() {
            body.removeChild(video);
            body.removeChild(controls);
            body.appendChild(homeLogo);
        },
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
        // The filter reports what it gives the player each time a playlist loads (~2s).
        report(state, seconds = 0) {
            const fire = () => onClock(() => (listeners['celadontv:adbreak'] || []).forEach((fn) => fn({ detail: { state } })));
            fire();
            for (let s = 2; s <= seconds; s += 2) {
                tv.tick(2000);
                tv.video.currentTime += 2;
                fire();
            }
        },
        key() {
            onClock(() => (listeners.keydown || []).forEach((fn) => fn({ preventDefault() { throw new Error('keys must reach the player'); }, stopPropagation() { throw new Error('keys must reach the player'); } })));
        },
    };
    body.appendChild(homeLogo);
    return tv;
}

test('the notice shows only over the bare full-screen player while a break is being blocked', () => {
    const tv = fakeTv();
    install(tv.win);
    tv.report('backup');
    tv.tick(400);
    assert.ok(!tv.showing(), 'never on the home screen (no player)');

    tv.openPlayer();
    tv.report('backup', 4);
    assert.ok(tv.showing(), 'shown over the playing video');

    // Any player UI coming up hides it, not just the button under it: here the controls
    // layer fades in on a key press (Go Back top-left, Follow bottom-right).
    tv.controls.computed.opacity = '1';
    tv.key();
    tv.tick(0);
    assert.ok(!tv.showing(), 'out of the way as soon as the controls are up');
    tv.controls.computed.opacity = '0.3';
    tv.report('backup', 2);
    assert.ok(!tv.showing(), 'still away while they fade');
    tv.controls.computed.opacity = '0';
    tv.report('backup', 2);
    assert.ok(tv.showing(), 'back over the bare video');

    // The break ends: gone, and it stays gone through normal live playback.
    tv.report('none', 2);
    tv.report('none', 60);
    assert.ok(!tv.showing());
    assert.ok(tv.records.includes('break state cleared: the break ended'));
});

test('leaving the player clears the break, so the notice never follows to other screens', () => {
    const tv = fakeTv();
    install(tv.win);
    tv.openPlayer();
    tv.report('backup', 4);
    assert.ok(tv.showing());

    tv.goHome();
    tv.tick(200);
    assert.ok(!tv.showing(), 'hidden the moment the player closes');
    assert.equal(tv.win.__ctvAdBreak.state, 'none');
    tv.tick(30000);
    assert.ok(!tv.showing(), 'and stays hidden on the home screen');

    // Opening another channel does not bring the old break back; only a new report does.
    tv.openPlayer();
    tv.tick(2000);
    assert.ok(!tv.showing());
    tv.report('backup');
    tv.tick(200);
    assert.ok(tv.showing());
});

test('a break whose reports stop is cleared after 15 seconds', () => {
    const tv = fakeTv();
    install(tv.win);
    tv.openPlayer();
    tv.report('held', 2);
    assert.ok(tv.showing());
    tv.tick(16000);
    assert.ok(!tv.showing());
});

test('the notice can never take focus, hover or pointer input', () => {
    const tv = fakeTv();
    install(tv.win);
    tv.openPlayer();
    tv.report('backup', 2);
    const notice = tv.notice();
    assert.equal(notice.getAttribute('tabindex'), '-1');
    assert.equal(notice.getAttribute('aria-hidden'), 'true');
    assert.equal(notice.inert, true);
    assert.match(notice.style.cssText, /pointer-events:none/);
    assert.match(notice.style.cssText, /outline:none/);
});

test('only a video filling most of the screen counts as the player', () => {
    const viewport = { width: 960, height: 540 };
    const at = (box) => ({ box });
    const rectOf = (v) => v.box;
    const shown = () => true;
    assert.equal(findPlayer([at(rect(0, 0, 960, 540))], viewport, rectOf, shown).rect.width, 960, 'full screen');
    assert.ok(findPlayer([at(rect(0, 0, 720, 405))], viewport, rectOf, shown), 'next to chat');
    assert.equal(findPlayer([at(rect(40, 300, 240, 412))], viewport, rectOf, shown), null, 'a preview card');
    assert.equal(findPlayer([], viewport, rectOf, shown), null, 'home screen');
    assert.equal(findPlayer([at(rect(0, 0, 960, 540))], viewport, rectOf, () => false), null, 'a hidden video');
    assert.equal(noticeVisible({ adState: 'backup', player: { rect: rect(0, 0, 960, 540) }, uiShown: false }), true);
    assert.equal(noticeVisible({ adState: 'backup', player: null, uiShown: false }), false);
    assert.equal(noticeVisible({ adState: 'backup', player: { rect: rect(0, 0, 960, 540) }, uiShown: true }), false);
    assert.equal(noticeVisible({ adState: 'none', player: { rect: rect(0, 0, 960, 540) }, uiShown: false }), false);
});

test('only player UI that is actually showing counts', () => {
    const area = rect(0, 0, 960, 540);
    const at = (box, opacity = '1') => ({ box, opacity });
    const rectOf = (c) => c.box;
    const shown = (c) => parseFloat(c.opacity) >= 0.05;
    assert.equal(coversControls(area, [at(rect(830, 420, 915, 452))], rectOf, shown), true);
    assert.equal(coversControls(area, [at(rect(830, 420, 915, 452), '0')], rectOf, shown), false, 'faded out');
    assert.equal(coversControls(area, [at(rect(960, 20, 1200, 60))], rectOf, shown), false, 'beside the video');
    assert.equal(coversControls(area, [at(rect(50, 30, 50, 30))], rectOf, shown), false, 'zero-sized');
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

test('reopens the channel when Twitch shows its playback error screen, without looping', () => {
    const tv = fakeTv();
    install(tv.win);
    tv.openPlayer();
    tv.report('backup', 2);
    // Twitch replaces the player with "Oh bummer... An error occurred while playing this content".
    tv.goHome();
    tv.win.document.body.innerText = 'Oh bummer...\nAn error occurred while playing this content\nReload\nGo Back';
    tv.tick(2000);
    assert.ok(!tv.records.includes('RELOAD'), 'gives Twitch a moment first');
    tv.tick(3000);
    assert.equal(tv.records.filter((r) => r === 'RELOAD').length, 1, 'reopened once');

    // The same page staying broken (a reload that keeps failing) is retried at most 3 times
    // in 10 minutes, at least 20 seconds apart.
    tv.tick(10 * 60000 - 6000);
    assert.equal(tv.records.filter((r) => r === 'RELOAD').length, 3);
    assert.ok(tv.records.some((r) => r.startsWith('recover held back')));
});

test('recoveries share a budget that survives the reloads they cause', () => {
    const budget = createRecoveryBudget({ max: 3, windowMs: 600000, minGapMs: 20000 });
    assert.equal(budget.take(0), true);
    assert.equal(budget.take(10000), false, 'too soon');
    assert.equal(budget.take(30000), true);
    assert.equal(budget.take(60000), true);
    assert.equal(budget.take(90000), false, 'three in ten minutes');
    assert.equal(budget.take(600001), true, 'the first one has aged out');
    const reloaded = createRecoveryBudget({ history: budget.history });
    assert.equal(reloaded.take(600002), false, 'remembered across the reload');
});
