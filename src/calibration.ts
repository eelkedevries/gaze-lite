// Nine-point calibration: collects averaged eye-feature vectors paired with
// known on-screen targets. This is a per-frame state machine driven by the
// render loop; it only gathers samples — the gaze model is fitted in a later
// step. Targets and samples use normalized [0,1] viewport coordinates.

import type { EyeFeatures } from './types';
import type { CalibrationSample } from './types';

export type { CalibrationSample };

/** A calibration target in normalized [0,1] viewport coordinates. */
export interface CalibrationPoint {
  x: number;
  y: number;
}

export type CalibrationPhase = 'dwell' | 'collecting' | 'complete' | 'failed';

export interface CalibrationState {
  points: CalibrationPoint[];
  /** Index of the point currently being shown. */
  index: number;
  phase: CalibrationPhase;
  samples: CalibrationSample[];
  error?: string;
  // Internal bookkeeping for the per-frame state machine.
  phaseStart: number;
  buffer: number[][];
  retried: boolean;
}

// Let the eye settle on the target before sampling, then average a short burst.
const DWELL_MS = 500;
const COLLECT_MS = 1000;
// Minimum accepted (both-eyes-tracked) frames per point; below this we retry.
const MIN_SAMPLES = 8;

/**
 * Nine targets ordered top-left → bottom-right. Defaults keep the points away
 * from the extreme edges so they stay visible and touch-friendly on mobile.
 */
export function createNinePointCalibrationLayout(
  xs: readonly [number, number, number] = [0.12, 0.5, 0.88],
  ys: readonly [number, number, number] = [0.14, 0.5, 0.86],
): CalibrationPoint[] {
  const points: CalibrationPoint[] = [];
  for (const y of ys) {
    for (const x of xs) {
      points.push({ x, y });
    }
  }
  return points;
}

export function startCalibration(now: number): CalibrationState {
  return {
    points: createNinePointCalibrationLayout(),
    index: 0,
    phase: 'dwell',
    samples: [],
    phaseStart: now,
    buffer: [],
    retried: false,
  };
}

function averageVectors(vectors: number[][]): number[] {
  const len = vectors[0].length;
  const out = new Array<number>(len).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < len; i++) out[i] += v[i];
  }
  for (let i = 0; i < len; i++) out[i] /= vectors.length;
  return out;
}

/**
 * Advances the calibration state by one frame. Pass the latest eye features
 * (or `null` when both eyes are not tracked); only valid frames are sampled.
 * Mutates and returns `state`.
 */
export function updateCalibration(
  state: CalibrationState,
  now: number,
  features: EyeFeatures | null,
): CalibrationState {
  if (state.phase === 'complete' || state.phase === 'failed') return state;

  const elapsed = now - state.phaseStart;

  if (state.phase === 'dwell') {
    if (elapsed >= DWELL_MS) {
      state.phase = 'collecting';
      state.phaseStart = now;
      state.buffer = [];
    }
    return state;
  }

  // collecting
  if (features && features.confidence > 0) {
    state.buffer.push(features.featureVector);
  }
  if (elapsed < COLLECT_MS) return state;

  if (state.buffer.length >= MIN_SAMPLES) {
    state.samples.push({
      featureVector: averageVectors(state.buffer),
      target: state.points[state.index],
    });
    state.index += 1;
    state.retried = false;
    if (state.index >= state.points.length) {
      state.phase = 'complete';
    } else {
      state.phase = 'dwell';
      state.phaseStart = now;
      state.buffer = [];
    }
  } else if (!state.retried) {
    // One retry: re-show the same point before giving up.
    state.retried = true;
    state.phase = 'dwell';
    state.phaseStart = now;
    state.buffer = [];
  } else {
    state.phase = 'failed';
    state.error = `Not enough eye-tracking samples at point ${
      state.index + 1
    } of ${state.points.length}. Hold still, improve lighting, and keep both eyes visible.`;
  }
  return state;
}
