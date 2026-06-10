// Calibration: a per-frame state machine driven by the render loop. It shows
// nine fixation targets and collects one sample per valid frame (blink-gated,
// outlier-pruned), then runs a "head sweep" — the user keeps looking at a
// centre target while slowly moving/turning their head. Sweep frames carry a
// fixed gaze label while the head-pose features vary, which is exactly the
// data the gaze model needs to learn head-movement compensation. The model
// itself is fitted in a later step. Targets and samples use normalized [0,1]
// viewport coordinates.

import { PRIMARY_GAZE_DIMS } from './eyeFeatures';
import type { CalibrationSample, EyeFeatures } from './types';

export type { CalibrationSample };

/** A calibration target in normalized [0,1] viewport coordinates. */
export interface CalibrationPoint {
  x: number;
  y: number;
}

export type CalibrationPhase =
  | 'dwell'
  | 'collecting'
  | 'sweepIntro'
  | 'sweep'
  | 'complete'
  | 'failed';

export interface CalibrationState {
  points: CalibrationPoint[];
  /** Index of the point currently being shown (the sweep uses the centre). */
  index: number;
  phase: CalibrationPhase;
  samples: CalibrationSample[];
  /** Valid frames collected during the head sweep. */
  sweepFrames: number;
  error?: string;
  /** Non-fatal note (e.g. the sweep collected too little to help). */
  warning?: string;
  // Internal bookkeeping for the per-frame state machine.
  phaseStart: number;
  buffer: number[][];
  retried: boolean;
}

// Let the eye settle on the target before sampling, then collect a burst.
// On slow devices (low detection fps) the window extends past COLLECT_MS
// until enough frames arrived, up to the hard cap — so a weak phone gets a
// slower calibration instead of a failed one.
const DWELL_MS = 600;
const COLLECT_MS = 1200;
const COLLECT_MAX_MS = 3000;
/** Visual dwell per point (the target shrinks over this window). */
export const POINT_TOTAL_MS = DWELL_MS + COLLECT_MS;
// Head-sweep stage: a short instruction beat, then the collection window.
export const SWEEP_INTRO_MS = 1600;
export const SWEEP_MS = 7000;
/** Auxiliary samples (the head sweep) carry this pointIndex; the gaze model
 * always keeps them in the training folds. */
export const SWEEP_POINT_INDEX = -1;
// Minimum accepted (eyes-open, face-tracked) frames per point; below this we
// retry the point once. The sweep is best-effort: below its minimum it is
// dropped with a warning rather than failing the run.
const MIN_FRAMES_PER_POINT = 10;
const MIN_SWEEP_FRAMES = 20;
// Frames whose primary gaze features sit further than this many standard
// deviations from the point's mean are pruned (micro-saccades, distractions).
const OUTLIER_Z = 2.0;

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
    sweepFrames: 0,
    phaseStart: now,
    buffer: [],
    retried: false,
  };
}

/** The centre target shown during the head sweep. */
export function sweepTarget(state: CalibrationState): CalibrationPoint {
  return state.points[4] ?? { x: 0.5, y: 0.5 };
}

/**
 * Drops frames whose primary gaze dims are > OUTLIER_Z standard deviations
 * from the buffer mean. Falls back to the unfiltered buffer when pruning
 * would discard too much (a noisy-but-consistent burst beats no data).
 */
function pruneOutliers(buffer: number[][]): number[][] {
  if (buffer.length < 4) return buffer;
  const dims = PRIMARY_GAZE_DIMS;
  const mean = dims.map((d) => buffer.reduce((a, v) => a + v[d], 0) / buffer.length);
  const std = dims.map((d, k) =>
    Math.sqrt(buffer.reduce((a, v) => a + (v[d] - mean[k]) ** 2, 0) / buffer.length),
  );
  const kept = buffer.filter((v) =>
    dims.every((d, k) => std[k] < 1e-9 || Math.abs(v[d] - mean[k]) <= OUTLIER_Z * std[k]),
  );
  return kept.length >= Math.max(MIN_FRAMES_PER_POINT, buffer.length / 2) ? kept : buffer;
}

function isUsableFrame(features: EyeFeatures | null): features is EyeFeatures {
  return !!features && features.confidence > 0 && features.eyesOpen;
}

/**
 * Advances the calibration state by one frame. Pass the latest eye features
 * (or `null` when the face is not tracked); only blink-free tracked frames
 * are sampled. Mutates and returns `state`.
 */
export function updateCalibration(
  state: CalibrationState,
  now: number,
  features: EyeFeatures | null,
): CalibrationState {
  if (state.phase === 'complete' || state.phase === 'failed') return state;

  const elapsed = now - state.phaseStart;

  switch (state.phase) {
    case 'dwell': {
      if (elapsed >= DWELL_MS) {
        state.phase = 'collecting';
        state.phaseStart = now;
        state.buffer = [];
      }
      return state;
    }

    case 'collecting': {
      if (isUsableFrame(features)) {
        state.buffer.push(features.featureVector);
      }
      if (elapsed < COLLECT_MS) return state;
      if (state.buffer.length < MIN_FRAMES_PER_POINT && elapsed < COLLECT_MAX_MS) {
        return state; // low fps: keep the window open a little longer
      }

      const kept = pruneOutliers(state.buffer);
      if (kept.length >= MIN_FRAMES_PER_POINT) {
        const target = state.points[state.index];
        for (const fv of kept) {
          state.samples.push({ featureVector: fv, target, pointIndex: state.index });
        }
        state.index += 1;
        state.retried = false;
        if (state.index >= state.points.length) {
          state.phase = 'sweepIntro';
        } else {
          state.phase = 'dwell';
        }
        state.phaseStart = now;
        state.buffer = [];
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

    case 'sweepIntro': {
      if (elapsed >= SWEEP_INTRO_MS) {
        state.phase = 'sweep';
        state.phaseStart = now;
        state.buffer = [];
      }
      return state;
    }

    case 'sweep': {
      if (isUsableFrame(features)) {
        state.buffer.push(features.featureVector);
      }
      if (elapsed < SWEEP_MS) return state;

      state.sweepFrames = state.buffer.length;
      if (state.buffer.length >= MIN_SWEEP_FRAMES) {
        const target = sweepTarget(state);
        for (const fv of state.buffer) {
          state.samples.push({ featureVector: fv, target, pointIndex: SWEEP_POINT_INDEX });
        }
      } else {
        state.warning =
          'Head sweep collected too few frames — head-movement compensation will be weak.';
      }
      state.buffer = [];
      state.phase = 'complete';
      return state;
    }
  }
  return state;
}
