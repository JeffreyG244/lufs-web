# lufs-web

Bit-exact **BS.1770-4 Integrated LUFS**, **LRA**, and **True Peak** measurement for the browser, Web Workers, and Node — pulled from [luvlang.studio](https://luvlang.studio)'s production mastering chain.

[![npm version](https://img.shields.io/npm/v/lufs-web.svg)](https://www.npmjs.com/package/lufs-web) [![tests](https://github.com/JeffreyG244/lufs-web/actions/workflows/test.yml/badge.svg)](https://github.com/JeffreyG244/lufs-web/actions) [![bundle size](https://img.shields.io/bundlephobia/minzip/lufs-web)](https://bundlephobia.com/package/lufs-web) [![license MIT](https://img.shields.io/npm/l/lufs-web.svg)](LICENSE)

- ✅ **BS.1770-4 K-weighted Integrated LUFS** with absolute (-70) + relative (-10) gating
- ✅ **BS.1771 / EBU R128 LRA** — 3 s short-term blocks, 10th–95th percentile
- ✅ **BS.1770-5 True Peak** — 4× polyphase sinc oversampling (24-tap Blackman-Harris)
- ✅ **Mono-sum LUFS** for mono-compatibility checks
- ✅ **Sample-rate aware** — works at 44.1, 48, 88.2, 96, 176.4, 192 kHz (and anything in between)
- ✅ **Zero dependencies**, pure ES module, ~10 KB minified
- ✅ **Browser, Web Worker, and Node** — same API everywhere
- ✅ Algorithm validated against a 21-case libebur128 reference harness in production

**Live demo:** [luvlang.studio/free-lufs-check](https://luvlang.studio/free-lufs-check) — drop a track in your browser and see the numbers.

## Why this exists

Most LUFS libraries on npm are either Node-only (FFmpeg bindings), WASM-heavy (libebur128 ports), or approximations that drift on non-48k content. `lufs-web` is the **same pure-JS implementation** that powers a live mastering platform — small enough to ship in a Web Worker, accurate enough to use in production, and free of native dependencies.

## Install

```bash
npm install lufs-web
```

## Usage

### Full measurement (Integrated LUFS + LRA + True Peak + mono-sum)

```js
import { measure } from 'lufs-web';

// AudioContext.decodeAudioData → AudioBuffer
const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

const result = measure({
    sampleRate: audioBuffer.sampleRate,
    channels: [
        audioBuffer.getChannelData(0),
        audioBuffer.getChannelData(1),
    ],
});

console.log(result);
// {
//   integratedLUFS: -14.2,
//   lra: 7.3,
//   truePeakDB: -1.4,
//   truePeakLin: 0.853,
//   monoLUFS: -17.2,
//   monoDelta: 3.0,
// }
```

### Just one metric

```js
import { measureIntegratedLUFS, measureLRA, measureTruePeak } from 'lufs-web';

const lufs = measureIntegratedLUFS({ sampleRate: 48000, channels: [L, R] });
const lra  = measureLRA({ sampleRate: 48000, channels: [L, R] });
const { truePeakDB } = measureTruePeak({ channels: [L, R] });
```

### Inside a Web Worker (recommended for full tracks)

```js
// worker.js
import { measure } from 'lufs-web';

self.onmessage = ({ data: { sampleRate, channels } }) => {
    const result = measure({ sampleRate, channels });
    self.postMessage(result);
};
```

```js
// main.js — transfer channel buffers zero-copy
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
worker.postMessage(
    { sampleRate, channels: [L, R] },
    [L.buffer, R.buffer],
);
```

## Streaming platform targets

For reference — what each platform normalizes to:

| Platform | Target LUFS | True Peak ceiling |
|---|---|---|
| Spotify | −14 | −1.0 dBTP |
| Apple Music | −16 | −1.0 dBTP |
| YouTube | −14 | −1.0 dBTP |
| Tidal | −14 | −1.0 dBTP |
| Amazon Music | −14 | −2.0 dBTP |
| Deezer | −15 | −1.0 dBTP |
| Vinyl (safe) | −12 | −3.0 dBTP |
| Broadcast (EBU R128) | −23 | −1.0 dBTP |

If your master is louder than the target, the platform applies negative gain at playback — **it does not put dynamics back into the audio**. A master at −7 LUFS gets ~7 dB of gain reduction on Spotify, ending up quieter and flatter at the listener than a master correctly targeted at −14.

## API

### `measure({ sampleRate, channels })`

Full BS.1770-4 measurement. Returns:

```ts
{
    integratedLUFS: number;  // gated mean per BS.1770-4 §3. -70 for silence.
    lra: number;             // BS.1771 loudness range in LU. 0 for tracks < 3 s.
    truePeakDB: number;      // capped at 0 dBTP. Above 0 = inter-sample clipping.
    truePeakLin: number;     // linear amplitude at the peak
    monoLUFS: number;        // integrated LUFS after L+R mono-sum
    monoDelta: number;       // stereo - mono. Positive = mono is quieter.
}
```

### `measureIntegratedLUFS({ sampleRate, channels })`

Just the integrated LUFS. Cheapest path if you don't need LRA or true-peak.

### `measureLRA({ sampleRate, channels })`

Just the loudness range (LU).

### `measureTruePeak({ channels })`

Just the inter-sample peak. No sample rate needed — it's a per-sample calculation.

### `computeKCoeffs(sampleRate)` / `kWeight(samples, coeffs)` / `biquadDF2T(samples, ...)`

Low-level building blocks — re-exported in case you want to roll your own gating strategy.

## Accuracy notes

- The K-weighting biquad coefficients are exact to libebur128's reference implementation, derived per BS.1770-4 §2.1.
- Integrated LUFS gating: absolute (-70 LUFS) → mean → relative (-10 LU from mean). Identical to libebur128.
- LRA gating: absolute (-70) → mean → relative (-20) → 10th/95th percentile of the gated short-term distribution. Per EBU Tech 3342.
- True peak: 4× oversampling with a 24-tap sinc kernel windowed by a 4-term Blackman-Harris (-92 dB sidelobes). DC-normalized to unity gain.

The production version this was extracted from is validated against:

- 21 reference signals (BS.1770-4 Annex 1 + EBU Tech 3341 vectors)
- 4 sample rates (44.1, 48, 96, 192 kHz)
- K-weighting cancellation tests (white noise in → flat dB out after k-weight removal)

You can run the included unit tests with `npm test`.

## Performance

A 3-minute stereo 48 kHz track measures in ~150 ms on an M1 Mac. The K-weighting filters dominate (linear in samples). For long tracks or low-end devices, run inside a Web Worker.

## License

MIT — see [LICENSE](LICENSE). Pulled from [LuvLang Studio](https://luvlang.studio)'s production mastering chain with permission.

## Why open-source?

We use this every day in [luvlang.studio](https://luvlang.studio) to measure every track that runs through our 24-stage mastering chain. The code is small, well-tested, and useful to anyone building audio tools for the browser — so we open-sourced it. PRs welcome.

If you want to hear what a full mastering chain does to your track, drop one at [luvlang.studio/app](https://luvlang.studio/app) — A/B preview is free.
