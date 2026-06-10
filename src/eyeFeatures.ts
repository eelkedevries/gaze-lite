// Extracts both eyes (boxes, centres, iris centres) and the gaze feature
// vector from MediaPipe face landmarks. Geometry outputs stay in the video's
// normalized [0,1] coordinate space; the feature vector is engineered to be
// as head-pose-invariant as possible, with explicit pose terms so the
// calibrated model can learn to compensate for the remaining head movement.

import type {
  EyeBox,
  EyeFeatures,
  FaceTrackingResult,
  HeadPose,
  NormalisedPoint,
  Point,
} from './types';

export type { EyeBox, EyeFeatures } from './types';

/**
 * Version of the feature-vector layout below. Bump when the layout changes so
 * persisted calibrations from older layouts are discarded instead of misread.
 */
export const FEATURE_VERSION = 3;

/** Dimensionality of the feature vector produced by {@link extractEyeFeatures}. */
export const FEATURE_DIM = 24;

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

// Below this determinant the head is turned so far that the projective
// inversion is ill-conditioned (≳ ~78° yaw) — fall back to the planar method.
const MIN_PROJECTION_DET = 0.2;

/**
 * Eye-in-head gaze offset for one eye, recovered by inverting the weak-
 * perspective projection: the observed 2-D iris offset is expressed as
 * a·P(R·x̂) + b·P(R·ŷ), where R is the head rotation and P projects camera
 * space into (aspect-corrected, y-down) image space. Solving the 2×2 system
 * for (a, b) yields the offset in the head's own frame — invariant to head
 * roll/yaw/pitch by construction, and (after dividing by the de-foreshortened
 * corner distance) to scale. Camera rotation is relative head rotation, so a
 * moving phone is compensated the same way. Iris/eye landmark depth — the
 * least reliable output — is never used; only the matrix-derived rotation.
 *
 * Signs: +a = subject's anatomical left, +b = up (head frame). Without a
 * pose, falls back to the eye's corner-aligned 2-D frame (exact under roll
 * only). `fromIdx → toIdx` must run along the head's +x̂ (toward the
 * subject's left) so both eyes share the convention.
 */
function eyeInHeadGaze(
  landmarks: NormalisedPoint[],
  fromIdx: number,
  toIdx: number,
  irisIdx: number,
  aspect: number,
  pose: HeadPose | null,
): Point {
  // Aspect-correct so x and y are in the same physical units before mixing.
  const fx = landmarks[fromIdx].x * aspect;
  const fy = landmarks[fromIdx].y;
  const tx = landmarks[toIdx].x * aspect;
  const ty = landmarks[toIdx].y;
  const dx = landmarks[irisIdx].x * aspect - (fx + tx) / 2;
  const dy = landmarks[irisIdx].y - (fy + ty) / 2;
  const ax = tx - fx;
  const ay = ty - fy;
  const widthImg = Math.max(Math.hypot(ax, ay), 1e-4);

  if (pose) {
    // Head axes projected into image space (metric +y is up, image y is down).
    const r = pose.rotation;
    const e1 = { x: r[0][0], y: -r[1][0] };
    const e2 = { x: r[0][1], y: -r[1][1] };
    const det = e1.x * e2.y - e2.x * e1.y;
    if (Math.abs(det) >= MIN_PROJECTION_DET) {
      const a = (e2.y * dx - e2.x * dy) / det;
      const b = (-e1.y * dx + e1.x * dy) / det;
      // The corners lie along x̂, so their projected distance shrinks by
      // |P(x̂)|; divide it out to recover the true (head-frame) eye width.
      const width = widthImg / Math.max(Math.hypot(e1.x, e1.y), 0.2);
      return { x: a / width, y: b / width };
    }
  }

  // Planar fallback: the eye's own corner-aligned frame (cancels roll/scale).
  const ux = ax / widthImg;
  const uy = ay / widthImg;
  return {
    x: (dx * ux + dy * uy) / widthImg,
    y: -(-dx * uy + dy * ux) / widthImg, // flip so +y is up, like the pose path
  };
}

// Approximate mid-eye position in the canonical face frame (cm): between the
// eyes, slightly above and in front of the canonical origin. Constant errors
// here only matter to second order (they rotate with the head).
const EYE_CENTER_HEAD: [number, number, number] = [0, 2.8, 4.2];
// Iris offset (fraction of corner distance) → tan(eyeball rotation):
// corner distance ≈ 28 mm, eyeball radius ≈ 12 mm ⇒ ~2.33 per unit.
const GAZE_TAN_PER_OFFSET = 2.33;
const MIN_RAY_Z = 0.2;
const MAX_RAY_CM = 300;

/**
 * Where the gaze ray meets the camera plane (z = 0), in centimetres. Built
 * from the metric head pose and the eye-in-head gaze, this estimate is
 * compensated for head/camera translation and rotation *by construction* —
 * move the head (or the phone) while fixating, and it stays put. It is fed
 * to the model as two features (not used directly): calibration learns the
 * affine map from this plane to screen pixels and how much to trust it.
 */
function gazeRayIntersection(pose: HeadPose, gaze: Point): Point {
  const r = pose.rotation;
  const rot = (v: [number, number, number]): [number, number, number] => [
    r[0][0] * v[0] + r[0][1] * v[1] + r[0][2] * v[2],
    r[1][0] * v[0] + r[1][1] * v[1] + r[1][2] * v[2],
    r[2][0] * v[0] + r[2][1] * v[1] + r[2][2] * v[2],
  ];
  const e = rot(EYE_CENTER_HEAD);
  const eye: [number, number, number] = [pose.tx + e[0], pose.ty + e[1], pose.tz + e[2]];
  // The face looks along the head's +z (toward the camera).
  const dir = rot([GAZE_TAN_PER_OFFSET * gaze.x, GAZE_TAN_PER_OFFSET * gaze.y, 1]);
  const s = -eye[2] / Math.max(dir[2], MIN_RAY_Z);
  const clampCm = (v: number): number =>
    v < -MAX_RAY_CM ? -MAX_RAY_CM : v > MAX_RAY_CM ? MAX_RAY_CM : v;
  return { x: clampCm(eye[0] + s * dir[0]), y: clampCm(eye[1] + s * dir[1]) };
}

const bs = (b: Record<string, number> | null | undefined, name: string): number =>
  b?.[name] ?? 0;

/**
 * Builds {@link EyeFeatures} from a face-tracking result, or returns `null`
 * when no face / too few landmarks are available. `aspect` is the video's
 * width/height (needed to make normalized coordinates isotropic).
 *
 * Feature-vector layout (FEATURE_VERSION = 3, FEATURE_DIM = 24):
 *
 *   0-3   per-eye eye-in-head gaze offsets (Lx, Ly, Rx, Ry) — the iris offset
 *         de-projected into the head's own frame via the pose rotation and
 *         divided by the de-foreshortened eye width (invariant to head/camera
 *         roll, yaw, pitch, and scale by construction; +x = subject's left,
 *         +y = up). The primary gaze signal.
 *   4-7   per-eye blendshape gaze (Lx, Ly, Rx, Ry) from the eyeLook* shapes,
 *         signed so +x is image-right and +y is image-down for both eyes —
 *         a learned, largely pose-independent second opinion on eye rotation.
 *   8-10  head rotation: yaw, pitch, roll (radians).
 *   11-13 head translation: tx/|tz|, ty/|tz| (perspective lateral offsets) and
 *         |tz| (distance, cm) — lets the model correct for head movement.
 *   14    inter-ocular distance in normalized image units (image-space
 *         distance proxy, backup for the metric one).
 *   15-16 gaze-ray ∩ camera-plane intersection (x, y in cm) — a geometric
 *         gaze estimate that already cancels head/camera translation and
 *         rotation; calibration learns its mapping to pixels and its weight.
 *   17-19 quadratics of the combined gaze (cx², cy², cx·cy) — the standard
 *         2nd-order screen-mapping terms (cx/cy = mean of dims 0-3 per axis).
 *   20-23 gaze × pose interactions (cx·|tz|, cy·|tz|, cx·yaw, cy·pitch) —
 *         screen offset per unit eye rotation grows with distance and turn.
 *
 * Dims 8-14 and 20-23 barely vary during a head-still calibration; the model
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

  // Corner order runs along the head's +x̂ (toward the subject's left, which
  // is image-right when upright): right eye outer(33)→inner(133), left eye
  // inner(362)→outer(263).
  const leftGaze = hasIris
    ? eyeInHeadGaze(lm, LEFT_EYE_INNER, LEFT_EYE_OUTER, LEFT_IRIS_CENTER, aspect, pose)
    : { x: 0, y: 0 };
  const rightGaze = hasIris
    ? eyeInHeadGaze(lm, RIGHT_EYE_OUTER, RIGHT_EYE_INNER, RIGHT_IRIS_CENTER, aspect, pose)
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
  const ray = pose && hasIris ? gazeRayIntersection(pose, { x: cx, y: cy }) : { x: 0, y: 0 };

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
    ray.x,
    ray.y,
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
