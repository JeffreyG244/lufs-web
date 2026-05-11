// Integrated LUFS + LRA per ITU-R BS.1770-4 and EBU R128.
//
// Implements the gated mean-square block measurement specified in §3 of
// BS.1770-4: 400 ms blocks at 100 ms hops, absolute gate at -70 LUFS,
// relative gate at (mean - 10 LUFS).
//
// LRA follows EBU Tech 3342 / BS.1771: 3 s short-term blocks at 100 ms hops,
// absolute gate at -70, relative gate at (mean - 20), 10th–95th percentile
// of the gated short-term distribution.

import { computeKCoeffs, kWeight } from './k-weighting.js';

const ABS_GATE_LUFS = -70;
const REL_GATE_LUFS_OFFSET = -10;   // Integrated LUFS uses -10 from mean
const LRA_REL_GATE_OFFSET = -20;     // LRA uses -20 from mean
const LUFS_OFFSET = -0.691;          // BS.1770 calibration offset

function meanSquareToLUFS(zSum) {
    return zSum > 0 ? (LUFS_OFFSET + 10 * Math.log10(zSum)) : -120;
}

function lufsToLinear(lufs) {
    return Math.pow(10, (lufs - LUFS_OFFSET) / 10);
}

function linearMeanToLUFS(meanLinear) {
    return LUFS_OFFSET + 10 * Math.log10(meanLinear);
}

function gatedMean(blocks, relativeGateOffset) {
    const absGated = blocks.filter(b => b > ABS_GATE_LUFS);
    if (absGated.length === 0) return -70;
    const meanLin = absGated.reduce((s, b) => s + lufsToLinear(b), 0) / absGated.length;
    const meanLUFS = linearMeanToLUFS(meanLin);
    const relGated = absGated.filter(b => b > meanLUFS + relativeGateOffset);
    if (relGated.length === 0) return meanLUFS;
    const finalLin = relGated.reduce((s, b) => s + lufsToLinear(b), 0) / relGated.length;
    return linearMeanToLUFS(finalLin);
}

/**
 * Integrated LUFS per BS.1770-4 / EBU R128.
 *
 * @param {{sampleRate:number, channels:Float32Array[]}} input
 * @returns {number} Integrated loudness in LUFS. Returns -70 for silence.
 */
export function measureIntegratedLUFS({ sampleRate, channels }) {
    if (!channels?.length) return -70;
    const coeffs = computeKCoeffs(sampleRate);
    const kCh = channels.map(c => kWeight(c, coeffs));
    const len = kCh[0].length;
    const blockLen = Math.floor(0.4 * sampleRate);
    const blockStep = Math.floor(0.1 * sampleRate);
    const blocks = [];
    for (let start = 0; start + blockLen <= len; start += blockStep) {
        let zSum = 0;
        for (const k of kCh) {
            let chSumSq = 0;
            for (let i = 0; i < blockLen; i++) {
                const v = k[start + i];
                chSumSq += v * v;
            }
            zSum += chSumSq / blockLen;
        }
        blocks.push(meanSquareToLUFS(zSum));
    }
    return gatedMean(blocks, REL_GATE_LUFS_OFFSET);
}

/**
 * Loudness Range (LRA) per EBU Tech 3342 / BS.1771.
 *
 * @param {{sampleRate:number, channels:Float32Array[]}} input
 * @returns {number} LRA in LU. Returns 0 for tracks shorter than 3 s.
 */
export function measureLRA({ sampleRate, channels }) {
    if (!channels?.length) return 0;
    const coeffs = computeKCoeffs(sampleRate);
    const kCh = channels.map(c => kWeight(c, coeffs));
    const len = kCh[0].length;
    const stLen = Math.floor(3.0 * sampleRate);
    const stStep = Math.floor(0.1 * sampleRate);
    if (len < stLen) return 0;
    const stBlocks = [];
    for (let start = 0; start + stLen <= len; start += stStep) {
        let zSum = 0;
        for (const k of kCh) {
            let chSumSq = 0;
            for (let i = 0; i < stLen; i++) {
                const v = k[start + i];
                chSumSq += v * v;
            }
            zSum += chSumSq / stLen;
        }
        stBlocks.push(meanSquareToLUFS(zSum));
    }
    if (stBlocks.length <= 1) return 0;
    const stAbs = stBlocks.filter(b => b > ABS_GATE_LUFS);
    if (stAbs.length <= 1) return 0;
    const stMeanLin = stAbs.reduce((s, b) => s + lufsToLinear(b), 0) / stAbs.length;
    const stMeanLUFS = linearMeanToLUFS(stMeanLin);
    const stRel = stAbs.filter(b => b > stMeanLUFS + LRA_REL_GATE_OFFSET);
    if (stRel.length <= 1) return 0;
    stRel.sort((a, b) => a - b);
    const p10 = stRel[Math.floor(stRel.length * 0.10)];
    const p95 = stRel[Math.floor(stRel.length * 0.95)];
    return p95 - p10;
}
