// Maps eye features to an on-screen gaze point. The concrete model (e.g. ridge
// regression over calibration samples) lands in a later task.

import type { CalibrationSample, EyeFeatures, GazePrediction } from './types';

export interface GazeModel {
  fit(samples: readonly CalibrationSample[]): void;
  predict(features: EyeFeatures): GazePrediction;
}

export function createGazeModel(): GazeModel {
  throw new Error('createGazeModel is not implemented yet');
}
