import './style.css';
import { startCamera } from './camera';
import { createFaceTracker, type FaceTracker } from './faceLandmarks';
import { extractEyeFeatures } from './eyeFeatures';
import {
  clearGazeCanvas,
  clearPreviewOverlay,
  drawCalibrationTarget,
  drawEyeBoxes,
  resizeCanvasToDisplaySize,
} from './drawing';
import {
  startCalibration,
  updateCalibration,
  type CalibrationSample,
  type CalibrationState,
} from './calibration';
import type { EyeFeatures, FaceTrackingResult } from './types';

// GUI wiring: camera start/stop, face tracking, green eye boxes, and the
// 9-point calibration sweep. Gaze prediction is not wired up yet.

function requireEl<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required element: ${selector}`);
  return el;
}

const video = requireEl<HTMLVideoElement>('#video');
const overlay = requireEl<HTMLCanvasElement>('#overlay');
const gazeCanvas = requireEl<HTMLCanvasElement>('#gaze-canvas');
const statusEl = requireEl<HTMLParagraphElement>('#status');
const startBtn = requireEl<HTMLButtonElement>('#btn-start');
const stopBtn = requireEl<HTMLButtonElement>('#btn-stop');
const calibrateBtn = requireEl<HTMLButtonElement>('#btn-calibrate');
const printBtn = requireEl<HTMLButtonElement>('#btn-print');
const clearBtn = requireEl<HTMLButtonElement>('#btn-clear');

const gazeCtx = gazeCanvas.getContext('2d');
if (!gazeCtx) throw new Error('2D canvas context is unavailable');
const overlayCtx = overlay.getContext('2d');
if (!overlayCtx) throw new Error('2D canvas context is unavailable');

// Cached so the per-frame render loop only touches the DOM when text changes.
let lastStatus = '';
function setStatus(message: string): void {
  if (message === lastStatus) return;
  lastStatus = message;
  statusEl.textContent = message;
}

function resizeGazeCanvas(): void {
  resizeCanvasToDisplaySize(gazeCanvas, window.innerWidth, window.innerHeight);
}

function resizeOverlay(): void {
  const rect = video.getBoundingClientRect();
  resizeCanvasToDisplaySize(overlay, rect.width, rect.height);
}

function resizeAll(): void {
  resizeGazeCanvas();
  resizeOverlay();
}

window.addEventListener('resize', resizeAll);
window.addEventListener('orientationchange', resizeAll);
video.addEventListener('loadedmetadata', resizeOverlay);
new ResizeObserver(resizeOverlay).observe(video);
resizeAll();

let cameraStarted = false;
let streaming = false;
let tracker: FaceTracker | null = null;
let latestResult: FaceTrackingResult | null = null;
// Last frame where both eyes were cleanly tracked; kept for the gaze model.
let latestEyeFeatures: EyeFeatures | null = null;
// Active calibration run, or null when not calibrating.
let calibration: CalibrationState | null = null;
// Averaged samples from the most recent successful calibration.
let calibrationSamples: CalibrationSample[] = [];
// Once calibration ends, hold a steady status instead of live tracking text.
let postCalibrationStatus: string | null = null;

/** Latest frame's valid eye features, for the gaze model in the next step. */
export function getLatestEyeFeatures(): EyeFeatures | null {
  return latestEyeFeatures;
}

/** Averaged calibration samples from the last successful run, for the model. */
export function getCalibrationSamples(): CalibrationSample[] {
  return calibrationSamples;
}

const finishCalibration = (samples: CalibrationSample[]): void => {
  calibrationSamples = samples;
  calibration = null;
  clearGazeCanvas(gazeCtx);
  calibrateBtn.disabled = false;
  // Print gaze stays disabled until the gaze model lands in the next step.
  postCalibrationStatus = 'Calibration complete';
};

const failCalibration = (message: string): void => {
  calibration = null;
  clearGazeCanvas(gazeCtx);
  calibrateBtn.disabled = false;
  postCalibrationStatus = `Calibration failed: ${message}`;
};

const stepCalibration = (now: number, features: EyeFeatures | null): void => {
  const state = calibration;
  if (!state) return;
  updateCalibration(state, now, features);

  if (state.phase === 'complete') {
    finishCalibration(state.samples);
    return;
  }
  if (state.phase === 'failed') {
    failCalibration(state.error ?? 'Not enough samples.');
    return;
  }

  const label = `Calibration ${state.index + 1} / ${state.points.length}`;
  clearGazeCanvas(gazeCtx);
  drawCalibrationTarget(gazeCtx, state.points[state.index], label);
  setStatus(
    state.phase === 'collecting'
      ? `${label} — look at the dot, hold still`
      : `${label} — get ready…`,
  );
};

const detectLoop = (): void => {
  if (!streaming) return;
  if (tracker && video.readyState >= 2 && video.videoWidth > 0) {
    const now = performance.now();
    latestResult = tracker.detect(video, now);
    clearPreviewOverlay(overlayCtx);

    // Extract features and draw eye boxes whenever both eyes are tracked.
    let features: EyeFeatures | null = null;
    if (!latestResult.error && latestResult.hasFace) {
      const f = extractEyeFeatures(latestResult);
      if (f && f.confidence > 0) {
        features = f;
        latestEyeFeatures = f;
        drawEyeBoxes(overlayCtx, f, {
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          mirror: true,
        });
      }
    }

    if (calibration) {
      stepCalibration(now, features);
    } else if (postCalibrationStatus) {
      setStatus(postCalibrationStatus);
    } else if (latestResult.error) {
      setStatus(`Face tracker error: ${latestResult.error}`);
    } else if (!latestResult.hasFace) {
      setStatus('No face detected');
    } else if (features) {
      setStatus('Both eyes tracked');
    } else {
      setStatus('Face detected, eyes not stable');
    }
  }
  requestAnimationFrame(detectLoop);
};

const stopCamera = (): void => {
  streaming = false;
  calibration = null;
  postCalibrationStatus = null;
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
  tracker?.close();
  tracker = null;
  cameraStarted = false;
  clearPreviewOverlay(overlayCtx);
  clearGazeCanvas(gazeCtx);
  startBtn.disabled = false;
  stopBtn.disabled = true;
  calibrateBtn.disabled = true;
  printBtn.disabled = true;
  setStatus('Camera stopped');
};

startBtn.addEventListener('click', async () => {
  if (cameraStarted) return;
  startBtn.disabled = true;
  setStatus('Starting camera…');
  try {
    await startCamera(video);
    cameraStarted = true;
    stopBtn.disabled = false;
    setStatus('Camera ready');
    resizeOverlay();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'Camera failed to start.');
    startBtn.disabled = false;
    return;
  }

  setStatus('Loading face tracker');
  try {
    tracker = await createFaceTracker();
    streaming = true;
    calibrateBtn.disabled = false;
    requestAnimationFrame(detectLoop);
  } catch (err) {
    setStatus(`Face tracker error: ${err instanceof Error ? err.message : 'failed to load'}`);
  }
});

stopBtn.addEventListener('click', stopCamera);

calibrateBtn.addEventListener('click', () => {
  if (!streaming || !tracker) {
    setStatus('Start the camera before calibrating.');
    return;
  }
  if (calibration) return;
  postCalibrationStatus = null;
  printBtn.disabled = true;
  calibrateBtn.disabled = true;
  clearGazeCanvas(gazeCtx);
  calibration = startCalibration(performance.now());
  setStatus('Calibration 1 / 9 — get ready…');
});

printBtn.addEventListener('click', () => {
  setStatus('Gaze model not implemented yet');
});

clearBtn.addEventListener('click', () => {
  clearGazeCanvas(gazeCtx);
  setStatus('Gaze dot cleared');
});

stopBtn.disabled = true;
calibrateBtn.disabled = true;
printBtn.disabled = true;
setStatus('Idle — click "Start camera" to begin');
