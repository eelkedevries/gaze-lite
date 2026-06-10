// MediaPipe Face Landmarker wrapper. All @mediapipe/tasks-vision specifics are
// contained here; the rest of the app consumes the normalized FaceTrackingResult.
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { headPoseFromMatrix } from './headPose';
import type { FaceTrackingResult, NormalisedPoint } from './types';

// Both assets are served by the app itself (see scripts/copy-wasm.mjs and
// public/models). BASE_URL keeps the paths correct under the /gaze-lite/ base.
const WASM_PATH = `${import.meta.env.BASE_URL}mediapipe/wasm`;
const MODEL_PATH = `${import.meta.env.BASE_URL}models/face_landmarker.task`;

export interface FaceTracker {
  /** Detect on a video frame. `timestampMs` must strictly increase. */
  detect(video: HTMLVideoElement, timestampMs: number): FaceTrackingResult;
  /**
   * True once the underlying graph has thrown. MediaPipe does not recover
   * from in-graph errors (e.g. timestamp violations) — recreate the tracker.
   */
  isBroken(): boolean;
  /** Which inference delegate ended up active ('GPU' or 'CPU'). */
  delegate: 'GPU' | 'CPU';
  close(): void;
}

// iOS Safari has a history of GPU-delegate breakage in tasks-vision
// (OffscreenCanvas/WebGL2 quirks); start it on CPU directly.
function preferCpuDelegate(): boolean {
  const ua = navigator.userAgent;
  const isAppleTouch =
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return isAppleTouch;
}

async function createLandmarker(delegate: 'GPU' | 'CPU'): Promise<FaceLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    // Below the defaults (0.5) so tracking survives handheld camera motion
    // and blur instead of dropping the face (which froze the gaze dot);
    // downstream blink/EAR gates keep poor frames out of the model anyway.
    minFacePresenceConfidence: 0.35,
    minTrackingConfidence: 0.3,
    // Blendshapes feed blink gating + auxiliary eyeLook* gaze features; the
    // transformation matrix is the head-pose signal. The bundled
    // face_landmarker.task contains both submodels.
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
}

export async function createFaceTracker(): Promise<FaceTracker> {
  let landmarker: FaceLandmarker | null = null;
  let delegate: 'GPU' | 'CPU' = preferCpuDelegate() ? 'CPU' : 'GPU';
  try {
    landmarker = await createLandmarker(delegate);
  } catch {
    if (delegate === 'GPU') {
      // GPU init can fail on WebGL2-poor devices/browsers; retry on CPU.
      try {
        delegate = 'CPU';
        landmarker = await createLandmarker(delegate);
      } catch {
        landmarker = null;
      }
    }
  }
  if (!landmarker) {
    // Most often a missing/blocked model or WASM asset, or no network.
    throw new Error(
      'could not load the face model or runtime. Check your connection and that the model asset is deployed.',
    );
  }
  const lm = landmarker;

  // detectForVideo rejects non-monotonic timestamps; clamp to be safe.
  let lastTimestamp = -1;
  let broken = false;

  return {
    delegate,
    detect(video, timestampMs) {
      if (timestampMs <= lastTimestamp) timestampMs = lastTimestamp + 1;
      lastTimestamp = timestampMs;

      try {
        const result = lm.detectForVideo(video, timestampMs);
        const face = result.faceLandmarks?.[0];
        if (!face || face.length === 0) {
          return { hasFace: false, landmarks: [], timestampMs };
        }
        const landmarks: NormalisedPoint[] = face.map((p) => ({ x: p.x, y: p.y, z: p.z }));

        let blendshapes: Record<string, number> | null = null;
        const categories = result.faceBlendshapes?.[0]?.categories;
        if (categories && categories.length > 0) {
          blendshapes = {};
          for (const c of categories) blendshapes[c.categoryName] = c.score;
        }
        const headPose = headPoseFromMatrix(result.facialTransformationMatrixes?.[0]);

        return { hasFace: true, landmarks, blendshapes, headPose, timestampMs };
      } catch (err) {
        // MediaPipe graphs do not recover after throwing; flag for recreation.
        broken = true;
        return {
          hasFace: false,
          landmarks: [],
          timestampMs,
          error: err instanceof Error ? err.message : 'Face detection failed',
        };
      }
    },
    isBroken() {
      return broken;
    },
    close() {
      lm.close();
    },
  };
}
