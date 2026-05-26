// Extracts both eyes (boxes, centres, iris-like centres) and a stable numeric
// feature vector from MediaPipe face landmarks. All outputs are in the video's
// normalized [0,1] coordinate space, so they are resolution-independent.

import type { EyeBox, EyeFeatures, FaceTrackingResult, NormalisedPoint, Point } from './types';

export type { EyeBox, EyeFeatures } from './types';

// MediaPipe Face Landmarker indices (468-point mesh; 478 with the iris model).
// Names are anatomical: "right" is the subject's right eye, which appears on
// the LEFT of an un-mirrored frame. Each group traces one eye's lid contour;
// iris centres (468 / 473) exist only when the iris-refined model is loaded.
const RIGHT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const LEFT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const RIGHT_EYE_OUTER = 33;
const LEFT_EYE_OUTER = 263;
const RIGHT_IRIS_CENTER = 468;
const LEFT_IRIS_CENTER = 473;

const MIN_CONTOUR_LANDMARKS = 468; // highest contour index used is 466
const IRIS_LANDMARKS = 478;

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

// Where a point sits inside the eye box, in [0,1] per axis. ~0.5 looking
// straight ahead; shifts toward the gaze direction — the primary gaze signal.
function relativePosition(point: Point, box: EyeBox): Point {
  return {
    x: box.width > 0 ? (point.x - box.x) / box.width : 0.5,
    y: box.height > 0 ? (point.y - box.y) / box.height : 0.5,
  };
}

/**
 * Builds {@link EyeFeatures} from a face-tracking result, or returns `null` when
 * no face / too few landmarks are available.
 *
 * The `featureVector` deliberately contains ONLY the iris position within each
 * eye box — the values that actually move as gaze shifts during a head-still
 * calibration. Absolute eye/face positions and eye-box sizes were dropped: they
 * barely vary during calibration, so they were near-zero-variance dimensions
 * that made the linear gaze model extrapolate wildly (pinning the dot to a
 * screen corner). Layout:
 *
 *   0-1  left iris position within its eye box (x, y)
 *   2-3  right iris position within its eye box (x, y)
 */
export function extractEyeFeatures(result: FaceTrackingResult): EyeFeatures | null {
  const lm = result.landmarks;
  if (!result.hasFace || lm.length < MIN_CONTOUR_LANDMARKS) return null;

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

  const leftRel = relativePosition(leftIrisLikeCenter, leftEyeBox);
  const rightRel = relativePosition(rightIrisLikeCenter, rightEyeBox);

  const featureVector = [leftRel.x, leftRel.y, rightRel.x, rightRel.y];

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
    featureVector,
    confidence,
  };
}
