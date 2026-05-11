// BS.1770-4 K-weighting filters (sample-rate-aware, libebur128-exact)
//
// Two cascaded biquad filters approximate the K-weighting curve specified
// by ITU-R BS.1770-4 §2.1:
//   Stage 1: high-shelf (+3.999 dB above 1681.97 Hz)
//   Stage 2: RLB high-pass (38.13 Hz, Q ~0.5)
//
// Coefficient derivation follows libebur128's reference implementation;
// constants are exact to the bits used in the reference test vectors.
//
// Extracted from luvlang.studio's `dsp-worker.js` (the live mastering
// chain). Bit-exact to the 21-case BS.1770 test signal harness used in
// production at https://luvlang.studio.

/**
 * Compute K-weighting biquad coefficients for the given sample rate.
 * @param {number} sampleRate Audio sample rate in Hz (8000–192000+).
 * @returns {{shB0:number,shB1:number,shB2:number,shA1:number,shA2:number,hpB0:number,hpB1:number,hpB2:number,hpA1:number,hpA2:number}}
 */
export function computeKCoeffs(sampleRate) {
    const PI = Math.PI;
    // Stage 1 — High-shelf pre-filter (1681.97 Hz, +3.999 dB, Q=0.7071)
    const f0Sh = 1681.974450955533;
    const G = 3.999843853973347;
    const QSh = 0.7071752369554196;
    const KSh = Math.tan(PI * f0Sh / sampleRate);
    const Vh = Math.pow(10.0, G / 20.0);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    const a0Sh = 1.0 + KSh / QSh + KSh * KSh;
    const shB0 = (Vh + Vb * KSh / QSh + KSh * KSh) / a0Sh;
    const shB1 = 2.0 * (KSh * KSh - Vh) / a0Sh;
    const shB2 = (Vh - Vb * KSh / QSh + KSh * KSh) / a0Sh;
    const shA1 = 2.0 * (KSh * KSh - 1.0) / a0Sh;
    const shA2 = (1.0 - KSh / QSh + KSh * KSh) / a0Sh;
    // Stage 2 — RLB high-pass (38.13 Hz, Q ~0.5)
    const f0Hp = 38.13547087602444;
    const QHp = 0.5003270373238773;
    const KHp = Math.tan(PI * f0Hp / sampleRate);
    const a0Hp = 1.0 + KHp / QHp + KHp * KHp;
    const hpB0 = 1.0;
    const hpB1 = -2.0;
    const hpB2 = 1.0;
    const hpA1 = 2.0 * (KHp * KHp - 1.0) / a0Hp;
    const hpA2 = (1.0 - KHp / QHp + KHp * KHp) / a0Hp;
    return { shB0, shB1, shB2, shA1, shA2, hpB0, hpB1, hpB2, hpA1, hpA2 };
}

/**
 * Apply a Direct Form II Transposed biquad to a sample buffer.
 * Used internally to apply the K-weighting stages in sequence.
 * @param {Float32Array} samples Input sample buffer.
 * @param {number} b0
 * @param {number} b1
 * @param {number} b2
 * @param {number} a1
 * @param {number} a2
 * @returns {Float32Array} Filtered output buffer of equal length.
 */
export function biquadDF2T(samples, b0, b1, b2, a1, a2) {
    let z1 = 0, z2 = 0;
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        const x = samples[i];
        const y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;
        out[i] = y;
    }
    return out;
}

/**
 * Apply the full BS.1770-4 K-weighting (high-shelf + RLB high-pass) to a buffer.
 * @param {Float32Array} samples Input samples.
 * @param {ReturnType<typeof computeKCoeffs>} coeffs Pre-computed coefficients.
 * @returns {Float32Array} K-weighted output buffer.
 */
export function kWeight(samples, coeffs) {
    const shelved = biquadDF2T(samples, coeffs.shB0, coeffs.shB1, coeffs.shB2, coeffs.shA1, coeffs.shA2);
    return biquadDF2T(shelved, coeffs.hpB0, coeffs.hpB1, coeffs.hpB2, coeffs.hpA1, coeffs.hpA2);
}
