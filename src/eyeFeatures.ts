// Extracts both eyes (boxes, centres, iris centres) and the gaze feature
// vector from MediaPipe face landmarks. Geometry outputs stay in the video's
// normalized [0,1] coordinate space; the feature vector is engineered to be
// as head-pose-invariant as possible, with explicit pose terms so the
// calibrated model can learn to compensate for the remaining head movement.

import type {
  EyeBox,
  EyeFeatures,
  FaceTrackingResult,
  NormalisedPoint,
  Point,
} from './types';

export type { EyeBox, EyeFeatures } from './types';

/**
 * Version of the feature-vector layout below. Bump when the layout changes so
 * persisted calibrations from older layouts are discarded instead of misread.
 */
export const FEATURE_VERSION = 2;

/** Dimensionality of the feature vector produced by {@link extractEyeFeatures}. */
export const FEATURE_DIM = 22;

/** Indices of the primary (per-eye, head-frame) gaze dims — used for outlier pruning. */
export const PRIMARY_GAZE_DIMS = [0, 1, 2, 3] as const;

// MediaPipe Face Landmarker indices (468-point mesh; 478 with the iris model).
// Names are anatomical: "right" is the subject's right eye, which appears on
// the LEFT of an un-mirrored frame. Each group traces one eye's lid contour;
// iris centres (468 / 473) exist only when the iris-refined model is loaded.
const RIGHT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const LEFT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const RIGHT_EYE_OUTER = 33;
const RIGHT_EYE_INNER = 133;
const LEFT_EYE_OUTER = 263;
const LEFT_EYE_INNER = 362;
const RIGHT_IRIS_CENTER = 468;
const LEFT_IRIS_CENTER = 473;

// Lid/corner indices for an eye-aspect-ratio (openness) measure, per eye:
// [outer corner, inner corner, top lid, bottom lid].
const RIGHT_EYE_EAR = [33, 133, 159, 145] as const;
const LEFT_EYE_EAR = [263, 362, 386, 374] as const;

const MIN_CONTOUR_LANDMARKS = 468; // highest contour index used is 466
const IRIS_LANDMARKS = 478;

// A frame counts as a blink when either eyeBlink blendshape crosses this, or
// the eye-aspect-ratio quality collapses (fallback when blendshapes are off).
const BLINK_THRESHOLD = 0.5;
const MIN_OPEN_QUALITY = 0.2;

function boxFromIndices(landmarks: NormalisedPoint[], indices: number[]): EyeBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const i of indices) {
    const p = landmarks[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  // Pad outward so the box clearly surrounds the eye in the small preview.
  // Eyes are wide and short, so pad height proportionally more than width.
  const padX = w * 0.25;
  const padY = h * 0.6;
  return { x: minX - padX, y: minY - padY, width: w + 2 * padX, height: h + 2 * padY };
}

function center(box: EyeBox): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Eye openness as a [0,1] quality: vertical lid gap over eye width (an
// eye-aspect-ratio), mapped so a normally-open eye reads high and a blink low.
function eyeQuality(landmarks: NormalisedPoint[], idx: readonly number[]): number {
  const outer = landmarks[idx[0]];
  const inner = landmarks[idx[1]];
  const top = landmarks[idx[2]];
  const bottom = landmarks[idx[3]];
  const width = Math.hypot(outer.x - inner.x, outer.y - inner.y) || 1e-4;
  const ear = Math.hypot(top.x - bottom.x, top.y - bottom.y) / width;
  return Math.max(0, Math.min(1, (ear - 0.1) / 0.2));
}

/**
 * Eye-frame gaze offset for one eye: the iris centre relative to the
 * corner-to-corner midpoint, expressed in the eye's own 2-D frame (u along
 * the corner line, v perpendicular) and divided by the corner distance.
 *
 * Working in 2-D ratios anchored to the corners is deliberate: it cancels
 * head roll exactly and distance/yaw foreshortening to first order, without
 * touching landmark z — the least reliable component for iris/eye points.
 * `fromIdx → toIdx` must run toward image-right when the head is upright so
 * both eyes share a sign convention (+u = image-right, +v = image-down).
 * Residual yaw/pitch effects are handled by the pose features.
 */
function eyeFrameGaze(
  landmarks: NormalisedPoint[],
  fromIdx: number,
  toIdx: number,
  irisIdx: number,
  aspect: number,
): Point {
  // Aspect-correct so x and y are in the same physical units before mixing.
  const fx = landmarks[fromIdx].x * aspect;
  const fy = landmarks[fromIdx].y;
  const tx = landmarks[toIdx].x * aspect;
  const ty = landmarks[toIdx].y;
  const px = landmarks[irisIdx].x * aspect;
  const py = landmarks[irisIdx].y;

  const ax = tx - fx;
  const ay = ty - fy;
  const width = Math.max(Math.hypot(ax, ay), 1e-4);
  const ux = ax / width;
  const uy = ay / width;
  const dx = px - (fx + tx) / 2;
  const dy = py - (fy + ty) / 2;
  return {
    x: (dx * ux + dy * uy) / width,
    y: (-dx * uy + dy * ux) / width,
  };
}

const bs = (b: Record<string, number> | null | undefined, name: string): number =>
  b?.[name] ?? 0;

/**
 * Builds {@link EyeFeatures} from a face-tracking result, or returns `null`
 * when no face / too few landmarks are available. `aspect` is the video's
 * width/height (needed to make normalized coordinates isotropic).
 *
 * Feature-vector layout (FEATURE_VERSION = 2, FEATURE_DIM = 22):
 *
 *   0-3   per-eye eye-frame gaze offsets (Lx, Ly, Rx, Ry) — iris relative to
 *         the eye-corner midpoint in the eye's own corner-aligned 2-D frame,
 *         divided by eye width (roll- and scale-invariant by construction).
 *         The primary gaze signal.
 *   4-7   per-eye blendshape gaze (Lx, Ly, Rx, Ry) from the eyeLook* shapes,
 *         signed so +x is image-right and +y is image-down for both eyes —
 *         a learned, largely pose-independent second opinion on eye rotation.
 *   8-10  head rotation: yaw, pitch, roll (radians).
 *   11-13 head translation: tx/|tz|, ty/|tz| (perspective lateral offsets) and
 *         |tz| (distance, cm) — lets the model correct for head movement.
 *   14    inter-ocular distance in normalized image units (image-space
 *         distance proxy, backup for the metric one).
 *   15-17 quadratics of the combined gaze (cx², cy², cx·cy) — the standard
 *         2nd-order screen-mapping terms (cx/cy = mean of dims 0-3 per axis).
 *   18-21 gaze × pose interactions (cx·|tz|, cy·|tz|, cx·yaw, cy·pitch) —
 *         screen offset per unit eye rotation grows with distance and turn.
 *
 * Dims 8-14 and 18-21 barely vary during a head-still calibration; the model
 * standardizes with a floored divisor and L2-penalizes, so they only gain
 * weight when calibration actually exercises them (the head-sweep stage).
 */
export function extractEyeFeatures(
  result: FaceTrackingResult,
  aspect: number,
): EyeFeatures | null {
  const lm = result.landmarks;
  if (!result.hasFace || lm.length < MIN_CONTOUR_LANDMARKS) return null;
  if (!(aspect > 0)) aspect = 16 / 9;

  const pose = result.headPose ?? null;
  const shapes = result.blendshapes ?? null;

  const leftEyeBox = boxFromIndices(lm, LEFT_EYE);
  const rightEyeBox = boxFromIndices(lm, RIGHT_EYE);
  const leftEyeCenter = center(leftEyeBox);
  const rightEyeCenter = center(rightEyeBox);

  const hasIris = lm.length >= IRIS_LANDMARKS;
  const leftIrisLikeCenter: Point = hasIris
    ? { x: lm[LEFT_IRIS_CENTER].x, y: lm[LEFT_IRIS_CENTER].y }
    : leftEyeCenter;
  const rightIrisLikeCenter: Point = hasIris
    ? { x: lm[RIGHT_IRIS_CENTER].x, y: lm[RIGHT_IRIS_CENTER].y }
    : rightEyeCenter;

  const faceCenter: Point = {
    x: (leftEyeCenter.x + rightEyeCenter.x) / 2,
    y: (leftEyeCenter.y + rightEyeCenter.y) / 2,
  };
  // Inter-eye distance: a stable scale that grows as the face nears the camera.
  const faceScale = Math.max(
    1e-4,
    Math.hypot(
      lm[RIGHT_EYE_OUTER].x - lm[LEFT_EYE_OUTER].x,
      lm[RIGHT_EYE_OUTER].y - lm[LEFT_EYE_OUTER].y,
    ),
  );

  // Corner order runs toward image-right: right eye outer(33)→inner(133),
  // left eye inner(362)→outer(263).
  const leftGaze = hasIris
    ? eyeFrameGaze(lm, LEFT_EYE_INNER, LEFT_EYE_OUTER, LEFT_IRIS_CENTER, aspect)
    : { x: 0, y: 0 };
  const rightGaze = hasIris
    ? eyeFrameGaze(lm, RIGHT_EYE_OUTER, RIGHT_EYE_INNER, RIGHT_IRIS_CENTER, aspect)
    : { x: 0, y: 0 };

  // Blendshape gaze, signed so +x is image-right / +y is image-down for both
  // eyes (the subject's left eye looks "out" toward image-right; the right
  // eye looks "in" toward image-right).
  const lookXLeft = bs(shapes, 'eyeLookOutLeft') - bs(shapes, 'eyeLookInLeft');
  const lookYLeft = bs(shapes, 'eyeLookDownLeft') - bs(shapes, 'eyeLookUpLeft');
  const lookXRight = bs(shapes, 'eyeLookInRight') - bs(shapes, 'eyeLookOutRight');
  const lookYRight = bs(shapes, 'eyeLookDownRight') - bs(shapes, 'eyeLookUpRight');

  const yaw = pose?.yaw ?? 0;
  const pitch = pose?.pitch ?? 0;
  const roll = pose?.roll ?? 0;
  const dist = pose ? Math.max(Math.abs(pose.tz), 1) : 0;
  const px = pose ? pose.tx / dist : 0;
  const py = pose ? pose.ty / dist : 0;

  const cx = (leftGaze.x + rightGaze.x) / 2;
  const cy = (leftGaze.y + rightGaze.y) / 2;

  const featureVector = [
    leftGaze.x,
    leftGaze.y,
    rightGaze.x,
    rightGaze.y,
    lookXLeft,
    lookYLeft,
    lookXRight,
    lookYRight,
    yaw,
    pitch,
    roll,
    px,
    py,
    dist,
    faceScale,
    cx * cx,
    cy * cy,
    cx * cy,
    cx * dist,
    cy * dist,
    cx * yaw,
    cy * pitch,
  ];

  const leftQuality = eyeQuality(lm, LEFT_EYE_EAR);
  const rightQuality = eyeQuality(lm, RIGHT_EYE_EAR);
  const leftBlink = bs(shapes, 'eyeBlinkLeft');
  const rightBlink = bs(shapes, 'eyeBlinkRight');
  const eyesOpen =
    leftBlink < BLINK_THRESHOLD &&
    rightBlink < BLINK_THRESHOLD &&
    leftQuality > MIN_OPEN_QUALITY &&
    rightQuality > MIN_OPEN_QUALITY;

  const confidence =
    leftEyeBox.width > 0 &&
    leftEyeBox.height > 0 &&
    rightEyeBox.width > 0 &&
    rightEyeBox.height > 0
      ? 1
      : 0;

  return {
    leftEyeBox,
    rightEyeBox,
    leftEyeCenter,
    rightEyeCenter,
    leftIrisLikeCenter,
    rightIrisLikeCenter,
    faceCenter,
    faceScale,
    headPose: pose,
    leftBlink,
    rightBlink,
    eyesOpen,
    featureVector,
    confidence,
    leftQuality,
    rightQuality,
  };
}
