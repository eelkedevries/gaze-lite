// Maps an eye-feature vector to an on-screen gaze point using two small ridge
// regressions (feature vector → normalized screen x, and → screen y), fitted
// from the 9 averaged calibration samples. Features are standardized for
// numerical stability and an unpenalized intercept is included. No ML deps.

import type { CalibrationSample, Point } from './types';

// Small ridge penalty: enough to keep coefficients stable when there are more
// features than calibration points (9 samples, ~19 features), without washing
// out the fit. Applied to feature weights only, not the intercept.
const RIDGE_LAMBDA = 1e-2;
const MIN_SAMPLES = 3;
const EPSILON = 1e-6;

export interface GazeModel {
  /** Predicts a gaze point in normalized [0,1] viewport coordinates. */
  predict(features: number[]): Point;
}

export function fitGazeModel(samples: CalibrationSample[]): GazeModel {
  if (samples.length < MIN_SAMPLES) {
    throw new Error(
      `need at least ${MIN_SAMPLES} calibration samples, got ${samples.length}`,
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
    std[j] = Math.sqrt(std[j] / samples.length) || 1; // guard zero variance
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
  const wx = ridgeSolve(X, samples.map((s) => s.target.x), p);
  const wy = ridgeSolve(X, samples.map((s) => s.target.y), p);

  return {
    predict(features: number[]): Point {
      const row = standardize(features);
      let x = 0;
      let y = 0;
      for (let k = 0; k < p; k++) {
        x += row[k] * wx[k];
        y += row[k] * wy[k];
      }
      return { x: clamp01(x), y: clamp01(y) };
    },
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Builds and solves the ridge normal equations (XᵀX + λI')w = Xᵀy, where the
// intercept (index 0) is left unpenalized.
function ridgeSolve(X: number[][], y: number[], p: number): number[] {
  const A: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const b = new Array<number>(p).fill(0);
  for (let r = 0; r < X.length; r++) {
    const xr = X[r];
    for (let i = 0; i < p; i++) {
      b[i] += xr[i] * y[r];
      for (let j = 0; j < p; j++) A[i][j] += xr[i] * xr[j];
    }
  }
  for (let i = 1; i < p; i++) A[i][i] += RIDGE_LAMBDA;
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
