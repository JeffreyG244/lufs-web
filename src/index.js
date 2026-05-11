// lufs-web — BS.1770-4 Integrated LUFS, LRA, and True Peak measurement
// for the browser, Workers, and Node. Bit-exact to libebur128.
//
// Pulled from luvlang.studio's mastering chain. Powers the free analyzer
// at https://luvlang.studio/free-lufs-check.
//
// Zero dependencies. Pure ES module. ~10 KB minified.
//
// Quick start:
//
//     import { measure } from 'lufs-web';
//
//     const result = measure({
//         sampleRate: audioBuffer.sampleRate,
//         channels: [audioBuffer.getChannelData(0), audioBuffer.getChannelData(1)],
//     });
//     // { integratedLUFS: -14.2, lra: 7.3, truePeakDB: -1.4, ... }

import { computeKCoeffs, kWeight, biquadDF2T } from './k-weighting.js';
import { measureIntegratedLUFS, measureLRA } from './lufs.js';
import { measureTruePeak } from './true-peak.js';

const LUFS_OFFSET = -0.691;

/**
 * Full BS.1770-4 measurement: Integrated LUFS, LRA, True Peak, and an
 * optional mono-sum LUFS for mono-compatibility checks.
 *
 * @param {Object} input
 * @param {number} input.sampleRate    Audio sample rate (Hz)
 * @param {Float32Array[]} input.channels  1-N channel buffers (typically L/R)
 * @returns {{integratedLUFS:number, lra:number, truePeakDB:number, truePeakLin:number, monoLUFS:number, monoDelta:number}}
 *
 *   - `integratedLUFS` — full-track loudness per BS.1770-4 (-70 for silence)
 *   - `lra` — loudness range per BS.1771 (0 for tracks < 3 s)
 *   - `truePeakDB` — capped at 0 dBTP (above 0 indicates clipping at D-to-A)
 *   - `truePeakLin` — linear amplitude at the peak
 *   - `monoLUFS` — integrated LUFS after L+R mono-sum (mono-compat check)
 *   - `monoDelta` — `integratedLUFS - monoLUFS` (positive means mono is quieter)
 */
export function measure({ sampleRate, channels }) {
    if (!Array.isArray(channels) || channels.length === 0) {
        return { integratedLUFS: -70, lra: 0, truePeakDB: -70, truePeakLin: 0, monoLUFS: -70, monoDelta: 0 };
    }
    const integratedLUFS = measureIntegratedLUFS({ sampleRate, channels });
    const lra = measureLRA({ sampleRate, channels });
    const { truePeakDB, truePeakLin } = measureTruePeak({ channels });

    // Mono-sum LUFS — only meaningful when there are ≥ 2 channels.
    let monoLUFS = integratedLUFS;
    let monoDelta = 0;
    if (channels.length >= 2) {
        const len = channels[0].length;
        const mono = new Float32Array(len);
        const chL = channels[0];
        const chR = channels[1];
        for (let i = 0; i < len; i++) mono[i] = 0.5 * (chL[i] + chR[i]);
        monoLUFS = measureIntegratedLUFS({ sampleRate, channels: [mono] });
        monoDelta = integratedLUFS - monoLUFS;
    }

    return { integratedLUFS, lra, truePeakDB, truePeakLin, monoLUFS, monoDelta };
}

// Re-exports for users who want only one piece of the measurement.
export { measureIntegratedLUFS, measureLRA, measureTruePeak };
export { computeKCoeffs, kWeight, biquadDF2T };
export { LUFS_OFFSET };
