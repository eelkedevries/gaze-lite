// Face landmark detection. Will wrap @mediapipe/tasks-vision FaceLandmarker.
// Placeholder for the initial scaffold.

import type { Point2D } from './types';

export interface FaceLandmarkResult {
  landmarks: Point2D[];
}

export interface FaceLandmarker {
  detect(frame: CanvasImageSource): FaceLandmarkResult | null;
  close(): void;
}

export async function createFaceLandmarker(): Promise<FaceLandmarker> {
  throw new Error('createFaceLandmarker is not implemented yet');
}
