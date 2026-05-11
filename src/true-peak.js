// True-peak detection via 4× polyphase sinc oversampling.
//
// ITU-R BS.1770-5 §4: estimate the actual peak of the reconstructed analog
// signal between samples. Critical for distributor delivery — a track with
// inter-sample peaks above 0 dBTP will clip at the listener's D-to-A
// converter even when the digital sample peak is below 0 dBFS.
//
// Algorithm:
//   1) Pre-compute 4 polyphase filter banks (24-tap, Blackman-Harris-windowed sinc).
//   2) For each sample, evaluate phases 1..3 (phase 0 = original sample).
//   3) Track the absolute maximum across all phases and channels.

const OS_FACTOR = 4;        // 4× oversampling
const HALF_TAPS = 12;       // 24-tap kernel = 12 either side
const KERNEL_LEN = HALF_TAPS * 2;

function buildPolyphaseBank() {
    const bank = [];
    for (let phase = 0; phase < OS_FACTOR; phase++) {
        const coeffs = new Float32Array(KERNEL_LEN);
        for (let k = 0; k < KERNEL_LEN; k++) {
            const n = k - HALF_TAPS;
            const x = n + phase / OS_FACTOR;
            const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
            const wn = (k + phase / OS_FACTOR) / KERNEL_LEN;
            // Blackman-Harris 4-term window — broader main lobe than Hann,
            // -92 dB sidelobe attenuation. Standard for ISP/true-peak work.
            const win = 0.35875
                      - 0.48829 * Math.cos(2 * Math.PI * wn)
                      + 0.14128 * Math.cos(4 * Math.PI * wn)
                      - 0.01168 * Math.cos(6 * Math.PI * wn);
            coeffs[k] = sinc * win;
        }
        // DC-normalize so a constant input passes through at unity gain.
        let dcSum = 0;
        for (let k = 0; k < KERNEL_LEN; k++) dcSum += coeffs[k];
        if (Math.abs(dcSum) > 1e-9) {
            for (let k = 0; k < KERNEL_LEN; k++) coeffs[k] /= dcSum;
        }
        bank.push(coeffs);
    }
    return bank;
}

/**
 * Inter-sample (true) peak across all channels.
 *
 * @param {{channels:Float32Array[]}} input
 * @returns {{truePeakDB:number, truePeakLin:number}}
 *   `truePeakDB` capped at 0 dBTP (above-0 means clipping). `truePeakLin` is
 *   the linear sample amplitude that produced the peak.
 */
export function measureTruePeak({ channels }) {
    const bank = buildPolyphaseBank();
    let truePeakLin = 0;
    for (const ch of channels) {
        for (let i = HALF_TAPS; i < ch.length - HALF_TAPS; i++) {
            let peak = Math.abs(ch[i]);
            for (let phase = 1; phase < OS_FACTOR; phase++) {
                let interp = 0;
                const coeffs = bank[phase];
                for (let k = 0; k < KERNEL_LEN; k++) {
                    interp += ch[i + k - HALF_TAPS] * coeffs[k];
                }
                const abs = Math.abs(interp);
                if (abs > peak) peak = abs;
            }
            if (peak > truePeakLin) truePeakLin = peak;
        }
    }
    const truePeakDB = truePeakLin > 0 ? Math.min(20 * Math.log10(truePeakLin), 0) : -70;
    return { truePeakDB, truePeakLin };
}
