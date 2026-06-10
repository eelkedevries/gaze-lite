// Maps an eye-feature vector to an on-screen gaze point using two ridge
// regressions (feature vector → normalized screen x, and → screen y), fitted
// from per-frame calibration samples. Features are standardized (with a
// floored divisor) and the intercept is unpenalized; the ridge strength is
// chosen by leave-one-calibration-point-out cross-validation. No ML deps.

import type { CalibrationSample, Point } from './types';

// Ridge strengths tried by cross-validation, as fractions of the sample count
// (XᵀX of standardized features has diagonal ≈ n, so this keeps the shrinkage
// comparable across calibration lengths). The high end protects poor data.
const LAMBDA_RATIOS = [1e-4, 1e-3, 1e-2, 0.05, 0.25];
const FALLBACK_RATIO = 0.01;
// Floor on the per-feature standard deviation. Without it, a feature that
// barely varied during calibration gets a near-zero divisor, so any live
// drift produces a huge standardized value and the prediction shoots
// off-screen. Pose features sit at this floor until a head-sweep stage
// actually exercises them.
const STD_FLOOR = 1e-2;
const MIN_GROUPS = 4;
const MIN_SAMPLES = 24;
const EPSILON = 1e-9;

export interface GazeModel {
  /** Predicts a gaze point in normalized [0,1] viewport coordinates. */
  predict(features: number[]): Point;
  /** Cross-validated RMS error per axis in normalized screen units. */
  cvRmse: Point;
  /** The selected ridge strength (per-sample ratio), for diagnostics. */
  lambdaRatio: number;
}

export function fitGazeModel(samples: CalibrationSample[]): GazeModel {
  const groups = new Set<number>();
  for (const s of samples) if (s.pointIndex >= 0) groups.add(s.pointIndex);
  if (samples.length < MIN_SAMPLES || groups.size < MIN_GROUPS) {
    throw new Error(
      `need ≥${MIN_SAMPLES} samples over ≥${MIN_GROUPS} targets, got ${samples.length} over ${groups.size}`,
    );
  }
  const d = samples[0].featureVector.length;
  for (const s of samples) {
    if (s.featureVector.length !== d) {
      throw new Error('calibration samples have inconsistent feature lengths');
    }
  }

  // Standardize features to zero mean / unit variance for stability.
  const mean = new Array<number>(d).fill(0);
  const std = new Array<number>(d).fill(0);
  for (const s of samples) {
    for (let j = 0; j < d; j++) mean[j] += s.featureVector[j];
  }
  for (let j = 0; j < d; j++) mean[j] /= samples.length;
  for (const s of samples) {
    for (let j = 0; j < d; j++) {
      const dx = s.featureVector[j] - mean[j];
      std[j] += dx * dx;
    }
  }
  for (let j = 0; j < d; j++) {
    std[j] = Math.max(Math.sqrt(std[j] / samples.length), STD_FLOOR);
  }

  // Design rows: [1, standardized features]; p = d + 1 (intercept at index 0).
  const p = d + 1;
  const standardize = (features: number[]): number[] => {
    const row = new Array<number>(p);
    row[0] = 1;
    for (let j = 0; j < d; j++) {
      const fv = features.length === d ? features[j] : mean[j];
      row[j + 1] = (fv - mean[j]) / std[j];
    }
    return row;
  };

  const X = samples.map((s) => standardize(s.featureVector));
  const yx = samples.map((s) => s.target.x);
  const yy = samples.map((s) => s.target.y);

  // Pick λ by leaving out one calibration point (all its frames) at a time.
  // Auxiliary samples (pointIndex < 0, e.g. the head sweep) always train.
  const folds = [...groups];
  let bestRatio = FALLBACK_RATIO;
  let bestErr = Infinity;
  let bestRmse: Point = { x: NaN, y: NaN };
  for (const ratio of LAMBDA_RATIOS) {
    const lambda = ratio * samples.length;
    let sqErrX = 0;
    let sqErrY = 0;
    let count = 0;
    for (const fold of folds) {
      const trainIdx: number[] = [];
      const testIdx: number[] = [];
      for (let i = 0; i < samples.length; i++) {
        (samples[i].pointIndex === fold ? testIdx : trainIdx).push(i);
      }
      const wx = ridgeSolve(trainIdx.map((i) => X[i]), trainIdx.map((i) => yx[i]), p, lambda);
      const wy = ridgeSolve(trainIdx.map((i) => X[i]), trainIdx.map((i) => yy[i]), p, lambda);
      for (const i of testIdx) {
        sqErrX += (dot(X[i], wx) - yx[i]) ** 2;
        sqErrY += (dot(X[i], wy) - yy[i]) ** 2;
        count += 1;
      }
    }
    const err = sqErrX + sqErrY;
    if (count > 0 && err < bestErr) {
      bestErr = err;
      bestRatio = ratio;
      bestRmse = { x: Math.sqrt(sqErrX / count), y: Math.sqrt(sqErrY / count) };
    }
  }

  const lambda = bestRatio * samples.length;
  const wx = ridgeSolve(X, yx, p, lambda);
  const wy = ridgeSolve(X, yy, p, lambda);

  return {
    predict(features: number[]): Point {
      const row = standardize(features);
      return { x: clamp01(dot(row, wx)), y: clamp01(dot(row, wy)) };
    },
    cvRmse: bestRmse,
    lambdaRatio: bestRatio,
  };
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Builds and solves the ridge normal equations (XᵀX + λI')w = Xᵀy, where the
// intercept (index 0) is left unpenalized.
function ridgeSolve(X: number[][], y: number[], p: number, lambda: number): number[] {
  const A: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const b = new Array<number>(p).fill(0);
  for (let r = 0; r < X.length; r++) {
    const xr = X[r];
    for (let i = 0; i < p; i++) {
      b[i] += xr[i] * y[r];
      for (let j = 0; j < p; j++) A[i][j] += xr[i] * xr[j];
    }
  }
  for (let i = 1; i < p; i++) A[i][i] += lambda;
  return solveLinearSystem(A, b);
}

// Gaussian elimination with partial pivoting.
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < EPSILON) {
      throw new Error('gaze model fit is singular');
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const pv = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map((row) => row[n]);
}
