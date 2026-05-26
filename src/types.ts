// Shared types for the gaze demo. Kept small; expanded as features land.

/** A point in pixel coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** Backward-compatible alias used by placeholder modules; prefer `Point`. */
export type Point2D = Point;

/** A landmark in MediaPipe's normalized space: x/y in [0,1], z relative. */
export interface NormalisedPoint {
  x: number;
  y: number;
  z?: number;
}

/** High-level tracker state, decoupled from MediaPipe's object shapes. */
export type TrackingStatus =
  | 'idle'
  | 'loading'
  | 'face-detected'
  | 'no-face'
  | 'error';

/** Normalized output of one face-detection frame. */
export interface FaceTrackingResult {
  hasFace: boolean;
  landmarks: NormalisedPoint[];
  timestampMs: number;
  confidence?: number;
  error?: string;
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
  target: Point;
}

/** Predicted on-screen gaze location, in normalized [0,1] coords. */
export interface GazePrediction {
  point: Point;
  confidence?: number;
}

export type AppPhase = 'idle' | 'camera' | 'calibrating' | 'tracking';
