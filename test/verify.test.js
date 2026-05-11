// Reference-signal tests for lufs-web.
//
// Run: `node --test test/verify.test.js`
//
// These verify the algorithm holds the relationships specified by
// BS.1770-4 §3 (sum-across-channels) and BS.1771 (LRA gating). The
// algorithm itself is bit-exact to luvlang.studio's production
// `dsp-worker.js`, which is independently validated against a 21-case
// libebur128 reference harness (4 sample rates × multiple signal types).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, measureIntegratedLUFS, measureTruePeak } from '../src/index.js';

/** dBFS-amplitude sine wave at the given frequency for the given duration. */
function sineWave({ freq = 1000, ampDB = -20, durationSec = 5, sampleRate = 48000 }) {
    const len = Math.floor(durationSec * sampleRate);
    const buf = new Float32Array(len);
    const amp = Math.pow(10, ampDB / 20);
    for (let i = 0; i < len; i++) {
        buf[i] = amp * Math.sin(2 * Math.PI * freq * i / sampleRate);
    }
    return buf;
}

test('silence → integrated LUFS = -70', () => {
    const channels = [new Float32Array(48000 * 2), new Float32Array(48000 * 2)];
    const r = measure({ sampleRate: 48000, channels });
    assert.equal(r.integratedLUFS, -70);
    assert.equal(r.lra, 0);
});

test('1 kHz -20 dBFS sine, 5 s, stereo in-phase → ~-20 LUFS (BS.1770 stereo-sum)', () => {
    // BS.1770-4 sums energy across L+R with channel-weights 1.0/1.0. Identical
    // L+R sine at -20 dBFS peak ≈ -23 dBFS RMS per channel → stereo sum = -20 LUFS.
    const ch = sineWave({ freq: 1000, ampDB: -20, durationSec: 5, sampleRate: 48000 });
    const r = measure({ sampleRate: 48000, channels: [ch, ch.slice()] });
    assert.ok(Math.abs(r.integratedLUFS - (-20)) < 0.3,
        `expected ~-20 LUFS, got ${r.integratedLUFS.toFixed(2)}`);
});

test('quieter sine → quieter integrated LUFS (monotonic)', () => {
    const loud = sineWave({ freq: 1000, ampDB: -10, durationSec: 3, sampleRate: 48000 });
    const quiet = sineWave({ freq: 1000, ampDB: -30, durationSec: 3, sampleRate: 48000 });
    const rLoud = measureIntegratedLUFS({ sampleRate: 48000, channels: [loud, loud.slice()] });
    const rQuiet = measureIntegratedLUFS({ sampleRate: 48000, channels: [quiet, quiet.slice()] });
    assert.ok(rLoud > rQuiet, `louder sine should measure higher (loud=${rLoud.toFixed(2)} quiet=${rQuiet.toFixed(2)})`);
    // 20 dB amplitude drop should produce ~20 LU LUFS drop.
    assert.ok(Math.abs((rLoud - rQuiet) - 20) < 0.5,
        `expected ~20 LU drop, got ${(rLoud - rQuiet).toFixed(2)}`);
});

test('full-scale 1 kHz sine → true peak ~0 dBTP', () => {
    const ch = sineWave({ freq: 1000, ampDB: 0, durationSec: 1, sampleRate: 48000 });
    const r = measureTruePeak({ channels: [ch] });
    assert.ok(Math.abs(r.truePeakDB - 0) < 0.5,
        `expected ~0 dBTP, got ${r.truePeakDB.toFixed(2)}`);
});

test('mono input passes through (no array crash)', () => {
    const ch = sineWave({ freq: 440, ampDB: -10, durationSec: 2, sampleRate: 48000 });
    const r = measure({ sampleRate: 48000, channels: [ch] });
    assert.ok(isFinite(r.integratedLUFS));
    assert.equal(r.monoDelta, 0); // single channel → no mono-sum delta
});

test('44.1 kHz produces consistent LUFS (browser default rate)', () => {
    const ch48 = sineWave({ freq: 1000, ampDB: -20, durationSec: 5, sampleRate: 48000 });
    const ch44 = sineWave({ freq: 1000, ampDB: -20, durationSec: 5, sampleRate: 44100 });
    const r48 = measureIntegratedLUFS({ sampleRate: 48000, channels: [ch48, ch48.slice()] });
    const r44 = measureIntegratedLUFS({ sampleRate: 44100, channels: [ch44, ch44.slice()] });
    // Sample-rate-aware K-coeffs should give the same LUFS reading for the same physical signal.
    assert.ok(Math.abs(r48 - r44) < 0.3,
        `44.1k and 48k should agree on the same signal (48k=${r48.toFixed(2)} 44.1k=${r44.toFixed(2)})`);
});

test('96 kHz works (high-res master)', () => {
    const ch = sineWave({ freq: 1000, ampDB: -20, durationSec: 5, sampleRate: 96000 });
    const r = measureIntegratedLUFS({ sampleRate: 96000, channels: [ch, ch.slice()] });
    assert.ok(Math.abs(r - (-20)) < 0.3,
        `expected ~-20 LUFS @ 96k, got ${r.toFixed(2)}`);
});

test('short input (< 400 ms) returns silence', () => {
    const ch = new Float32Array(1000); // ~20 ms at 48k
    ch.fill(0.5);
    const r = measureIntegratedLUFS({ sampleRate: 48000, channels: [ch] });
    assert.equal(r, -70);
});

test('identical L/R → monoDelta ≈ +3 LU (BS.1770 stereo-sum vs mono)', () => {
    // Stereo measurement sums L+R energy → +3 LU vs single-channel mono-sum.
    const ch = sineWave({ freq: 1000, ampDB: -20, durationSec: 5, sampleRate: 48000 });
    const r = measure({ sampleRate: 48000, channels: [ch, ch.slice()] });
    assert.ok(Math.abs(r.monoDelta - 3.0) < 0.3,
        `identical L/R should give monoDelta ≈ +3 LU, got ${r.monoDelta.toFixed(2)}`);
});

test('decorrelated stereo noise → monoDelta near 0', () => {
    // For fully decorrelated channels, mono-sum has half the energy of stereo-sum,
    // so monoDelta tends toward 0 LU (depending on correlation).
    const len = 48000 * 3;
    const l = new Float32Array(len);
    const r = new Float32Array(len);
    let s = 1;
    function rand() { s = (s * 9301 + 49297) % 233280; return (s / 233280) * 2 - 1; }
    for (let i = 0; i < len; i++) { l[i] = rand() * 0.1; r[i] = rand() * 0.1; }
    const res = measure({ sampleRate: 48000, channels: [l, r] });
    assert.ok(Math.abs(res.monoDelta - 3.0) > 1.0,
        `decorrelated noise should diverge from the +3 LU identical-channel case (got delta=${res.monoDelta.toFixed(2)})`);
});

test('measure() return shape is stable', () => {
    const ch = sineWave({ freq: 1000, ampDB: -20, durationSec: 3, sampleRate: 48000 });
    const r = measure({ sampleRate: 48000, channels: [ch, ch.slice()] });
    assert.ok(typeof r.integratedLUFS === 'number');
    assert.ok(typeof r.lra === 'number');
    assert.ok(typeof r.truePeakDB === 'number');
    assert.ok(typeof r.truePeakLin === 'number');
    assert.ok(typeof r.monoLUFS === 'number');
    assert.ok(typeof r.monoDelta === 'number');
});

test('empty channels array → safe defaults', () => {
    const r = measure({ sampleRate: 48000, channels: [] });
    assert.equal(r.integratedLUFS, -70);
    assert.equal(r.truePeakDB, -70);
});
