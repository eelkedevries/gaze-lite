// Collects calibration samples (eye features paired with on-screen targets)
// that train the gaze model. Placeholder for the initial scaffold.

import type { CalibrationSample, EyeFeatures, Point2D } from './types';

export class Calibration {
  private readonly samples: CalibrationSample[] = [];

  add(features: EyeFeatures, target: Point2D): void {
    this.samples.push({ features, target });
  }

  get count(): number {
    return this.samples.length;
  }

  getSamples(): readonly CalibrationSample[] {
    return this.samples;
  }

  reset(): void {
    this.samples.length = 0;
  }
}
