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

/** Axis-aligned box in normalized video-frame coordinates (x/y/w/h in [0,1]). */
export interface EyeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Per-frame eye geometry plus a numeric feature vector, all in the video's
 * normalized coordinate space so it stays resolution-independent. Consumed by
 * calibration and the gaze model in later steps.
 */
export interface EyeFeatures {
  leftEyeBox: EyeBox;
  rightEyeBox: EyeBox;
  leftEyeCenter: Point;
  rightEyeCenter: Point;
  /** Iris centre when the 478-point (iris) model is present; else eye centre. */
  leftIrisLikeCenter?: Point;
  rightIrisLikeCenter?: Point;
  faceCenter: Point;
  /** Inter-eye distance in normalized units; grows as the face nears the camera. */
  faceScale: number;
  /** Flat numeric feature vector; layout documented in eyeFeatures.ts. */
  featureVector: number[];
  /** 1 when both eyes are cleanly bounded, else 0. */
  confidence: number;
}

/** One calibration observation: averaged features while looking at a target. */
export interface CalibrationSample {
  /** Averaged eye-feature vector captured at the target. */
  featureVector: number[];
  /** Screen target the user was looking at, in normalized [0,1] coords. */
  target: Point;
}

/** Predicted on-screen gaze location, in normalized [0,1] coords. */
export interface GazePrediction {
  point: Point;
  confidence?: number;
}

export type AppPhase = 'idle' | 'camera' | 'calibrating' | 'tracking';
