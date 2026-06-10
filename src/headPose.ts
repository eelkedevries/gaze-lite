// Decomposes MediaPipe's facial transformation matrix (canonical face →
// camera metric space, centimetres) into a HeadPose: yaw/pitch/roll plus
// translation. The metric space is right-handed with X right, Y up and the
// face a few tens of centimetres along Z, so rotation angles are relative to
// looking straight into the camera.

import type { HeadPose } from './types';

/** Matrix shape produced by @mediapipe/tasks-vision (flattened 4×4). */
export interface FlatMatrix {
  rows: number;
  columns: number;
  data: number[];
}

/**
 * Builds a HeadPose from the 4×4 transformation matrix, or null when the
 * matrix is missing/malformed.
 *
 * The matrix is documented as column-major (translation in data[12..14]) and
 * composed of uniform scale · rotation · translation, in centimetres, in a
 * right-handed space with the camera at the origin looking down −Z and
 * +X = the subject's anatomical left. The flat data's majorness is still
 * detected from the matrix itself — a rigid transform's fourth row is
 * (0,0,0,1), so whichever slots hold the zero triple reveal the layout —
 * which keeps this correct even if the packing convention ever changes.
 */
export function headPoseFromMatrix(matrix: FlatMatrix | undefined): HeadPose | null {
  const d = matrix?.data;
  if (!d || d.length !== 16) return null;

  const rowMajor = Math.abs(d[12]) + Math.abs(d[13]) + Math.abs(d[14]) <= Math.abs(d[3]) + Math.abs(d[7]) + Math.abs(d[11]);
  const at = (r: number, c: number): number => (rowMajor ? d[r * 4 + c] : d[c * 4 + r]);

  // Divide out the uniform scale (canonical face size vs the real head) so
  // `rotation` is a pure rotation usable for projection.
  const scale = Math.hypot(at(0, 0), at(1, 0), at(2, 0));
  if (!(scale > 1e-6)) return null;
  const rotation = [
    [at(0, 0) / scale, at(0, 1) / scale, at(0, 2) / scale],
    [at(1, 0) / scale, at(1, 1) / scale, at(1, 2) / scale],
    [at(2, 0) / scale, at(2, 1) / scale, at(2, 2) / scale],
  ];
  const tx = at(0, 3);
  const ty = at(1, 3);
  const tz = at(2, 3);

  // Intrinsic Y(yaw)·X(pitch)·Z(roll) decomposition. With this convention:
  //   R[0][2] = sin(yaw)·cos(pitch)   R[1][2] = -sin(pitch)
  //   R[2][2] = cos(yaw)·cos(pitch)   R[1][0] = cos(pitch)·sin(roll)
  // Identity when looking straight into the camera; positive yaw turns
  // toward the subject's left.
  const yaw = Math.atan2(rotation[0][2], rotation[2][2]);
  const pitch = Math.atan2(-rotation[1][2], Math.hypot(rotation[0][2], rotation[2][2]));
  const roll = Math.atan2(rotation[1][0], rotation[1][1]);

  if (![yaw, pitch, roll, tx, ty, tz].every(Number.isFinite)) return null;
  return { yaw, pitch, roll, tx, ty, tz, rotation };
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}
