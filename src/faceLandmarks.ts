// MediaPipe Face Landmarker wrapper. All @mediapipe/tasks-vision specifics are
// contained here; the rest of the app consumes the normalized FaceTrackingResult.
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceTrackingResult, NormalisedPoint } from './types';

// Both assets are served by the app itself (see scripts/copy-wasm.mjs and
// public/models). BASE_URL keeps the paths correct under the /gaze-lite/ base.
const WASM_PATH = `${import.meta.env.BASE_URL}mediapipe/wasm`;
const MODEL_PATH = `${import.meta.env.BASE_URL}models/face_landmarker.task`;

export interface FaceTracker {
  /** Detect on a video frame. `timestampMs` must strictly increase. */
  detect(video: HTMLVideoElement, timestampMs: number): FaceTrackingResult;
  close(): void;
}

export async function createFaceTracker(): Promise<FaceTracker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_PATH },
    runningMode: 'VIDEO',
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });

  // detectForVideo rejects non-monotonic timestamps; clamp to be safe.
  let lastTimestamp = -1;

  return {
    detect(video, timestampMs) {
      if (timestampMs <= lastTimestamp) timestampMs = lastTimestamp + 1;
      lastTimestamp = timestampMs;

      try {
        const result = landmarker.detectForVideo(video, timestampMs);
        const face = result.faceLandmarks?.[0];
        if (!face || face.length === 0) {
          return { hasFace: false, landmarks: [], timestampMs };
        }
        const landmarks: NormalisedPoint[] = face.map((p) => ({ x: p.x, y: p.y, z: p.z }));
        return { hasFace: true, landmarks, timestampMs };
      } catch (err) {
        return {
          hasFace: false,
          landmarks: [],
          timestampMs,
          error: err instanceof Error ? err.message : 'Face detection failed',
        };
      }
    },
    close() {
      landmarker.close();
    },
  };
}
