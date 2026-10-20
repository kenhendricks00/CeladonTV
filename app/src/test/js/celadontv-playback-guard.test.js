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
