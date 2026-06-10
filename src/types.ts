// Shared types for the gaze demo. Kept small; expanded as features land.

/** A point in pixel coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** A landmark in MediaPipe's normalized space: x/y in [0,1], z relative. */
export interface NormalisedPoint {
  x: number;
  y: number;
  z?: number;
}

/**
 * Head pose decomposed from MediaPipe's facial transformation matrix.
 * Rotation is relative to facing the camera straight on; translation is the
 * head's position in the camera's metric space (centimetres).
 */
export interface HeadPose {
  /** Rotation about the vertical axis (left/right turn), radians. */
  yaw: number;
  /** Rotation about the horizontal axis (nod up/down), radians. */
  pitch: number;
  /** In-plane tilt toward a shoulder, radians. */
  roll: number;
  /** Head translation in camera space, centimetres. */
  tx: number;
  ty: number;
  tz: number;
  /** Full 3×3 rotation matrix (row-major) for drawing/projection. */
  rotation: number[][];
}

/** Normalized output of one face-detection frame. */
export interface FaceTrackingResult {
  hasFace: boolean;
  landmarks: NormalisedPoint[];
  timestampMs: number;
  /** Head pose from the facial transformation matrix, when available. */
  headPose?: HeadPose | null;
  /** Blendshape coefficients by name (e.g. eyeLookUpLeft), in [0,1]. */
  blendshapes?: Record<string, number> | null;
  confidence?: number;
  error?: string;
}

/** A crop window over the raw video frame, in video pixels. */
export interface FrameCrop {
  x: number;
  y: number;
  width: number;
  height: number;
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
  /** Head pose from the facial transformation matrix (null if unavailable). */
  headPose: HeadPose | null;
  /** Per-eye blink coefficient in [0,1] (≥ ~0.4 means the lid is closing). */
  leftBlink: number;
  rightBlink: number;
  /** True when neither eye is mid-blink — only such frames feed the model. */
  eyesOpen: boolean;
  /** Flat numeric feature vector; layout documented in eyeFeatures.ts. */
  featureVector: number[];
  /** 1 when both eyes are cleanly bounded, else 0. */
  confidence: number;
  /** Per-eye openness/visibility quality in [0,1] (drives readouts + box color). */
  leftQuality: number;
  rightQuality: number;
}

/** One calibration observation: one frame's features while looking at a target. */
export interface CalibrationSample {
  /** Eye-feature vector captured at the target. */
  featureVector: number[];
  /** Screen target the user was looking at, in normalized [0,1] coords. */
  target: Point;
  /**
   * Which calibration target produced this sample (used for grouped
   * cross-validation); the head-movement sweep uses its own index.
   */
  pointIndex: number;
}
