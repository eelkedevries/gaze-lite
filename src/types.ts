// Shared types for the gaze demo. Kept intentionally small for the initial
// scaffold; expand as camera, landmark, calibration and model code lands.

export interface Point2D {
  x: number;
  y: number;
}

/** Axis-aligned bounding box, in source-image pixel coordinates. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Per-eye region used to draw the green preview boxes. */
export interface EyeBoxes {
  left: BoundingBox;
  right: BoundingBox;
}

/** Numeric features extracted from the eyes, fed into the gaze model. */
export interface EyeFeatures {
  /** Flat feature vector; layout defined by eyeFeatures.ts later. */
  vector: number[];
}

/** One calibration observation: features captured while looking at a target. */
export interface CalibrationSample {
  features: EyeFeatures;
  /** Screen target the user was looking at, in normalized [0,1] coords. */
  target: Point2D;
}

/** Predicted on-screen gaze location, in normalized [0,1] coords. */
export interface GazePrediction {
  point: Point2D;
  /** Optional confidence in [0,1], if the model provides one. */
  confidence?: number;
}

export type AppPhase = 'idle' | 'camera' | 'calibrating' | 'tracking';
