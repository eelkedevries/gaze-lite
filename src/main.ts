import './style.css';
import { startCamera } from './camera';
import { createFaceTracker, type FaceTracker } from './faceLandmarks';
import { extractEyeFeatures } from './eyeFeatures';
import {
  clearGazeCanvas,
  clearPreviewOverlay,
  drawCalibrationTarget,
  drawEyeBoxes,
  drawGazeDot,
  resizeCanvasToDisplaySize,
} from './drawing';
import {
  startCalibration,
  updateCalibration,
  type CalibrationSample,
  type CalibrationState,
} from './calibration';
import { fitGazeModel, type GazeModel } from './gazeModel';
import type { EyeFeatures, FaceTrackingResult, Point } from './types';

// GUI wiring: camera start/stop, face tracking, green eye boxes, the 9-point
// calibration sweep, the calibrated gaze model, and the Print gaze red dot.

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

const onViewportChange = (): void => {
  resizeAll();
  // A resize / orientation change moves screen coordinates, so any existing
  // calibration no longer maps correctly — drop it and ask to recalibrate.
  if (gazeModel || calibration) invalidateCalibration();
};
window.addEventListener('resize', onViewportChange);
window.addEventListener('orientationchange', onViewportChange);
video.addEventListener('loadedmetadata', resizeOverlay);
new ResizeObserver(resizeOverlay).observe(video);
resizeAll();

let cameraStarted = false;
let streaming = false;
let tracker: FaceTracker | null = null;
let latestResult: FaceTrackingResult | null = null;
// Active calibration run, or null when not calibrating.
let calibration: CalibrationState | null = null;
// Fitted gaze model, or null until a successful calibration.
let gazeModel: GazeModel | null = null;
// When on, the render loop predicts and redraws the gaze dot every frame so it
// follows the user's gaze. Toggled by Print gaze; cleared by Clear dot.
let liveGaze = false;
// Exponentially-smoothed live gaze point, to damp per-frame jitter.
let smoothedGaze: Point | null = null;
// Once calibration ends, hold a steady status instead of live tracking text.
let postCalibrationStatus: string | null = null;

// EMA weight for the live dot: lower = smoother but laggier.
const GAZE_SMOOTHING = 0.35;

const setLiveGaze = (on: boolean): void => {
  liveGaze = on;
  smoothedGaze = null; // start each tracking session fresh
  printBtn.textContent = on ? 'Stop gaze' : 'Print gaze';
};

const finishCalibration = (samples: CalibrationSample[]): void => {
  calibration = null;
  clearGazeCanvas(gazeCtx);
  setLiveGaze(false);
  calibrateBtn.disabled = false;
  try {
    gazeModel = fitGazeModel(samples);
    printBtn.disabled = false;
    postCalibrationStatus = 'Calibrated — ready to print gaze';
  } catch (err) {
    gazeModel = null;
    printBtn.disabled = true;
    postCalibrationStatus = `Calibration failed: ${
      err instanceof Error ? err.message : 'could not fit gaze model'
    }`;
  }
};

const failCalibration = (message: string): void => {
  calibration = null;
  gazeModel = null;
  clearGazeCanvas(gazeCtx);
  setLiveGaze(false);
  calibrateBtn.disabled = false;
  printBtn.disabled = true;
  postCalibrationStatus = `Calibration failed: ${message}`;
};

// Calibration is screen-coordinate dependent, so a viewport change makes the
// stored targets meaningless; invalidate and ask the user to recalibrate.
const invalidateCalibration = (): void => {
  calibration = null;
  gazeModel = null;
  setLiveGaze(false);
  printBtn.disabled = true;
  clearGazeCanvas(gazeCtx);
  postCalibrationStatus = 'Viewport changed — please recalibrate';
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
        drawEyeBoxes(overlayCtx, f, {
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          mirror: true,
        });
      }
    }
    if (calibration) {
      stepCalibration(now, features);
    } else if (liveGaze && gazeModel) {
      if (features) {
        const raw = gazeModel.predict(features.featureVector);
        smoothedGaze = smoothedGaze
          ? {
              x: smoothedGaze.x + GAZE_SMOOTHING * (raw.x - smoothedGaze.x),
              y: smoothedGaze.y + GAZE_SMOOTHING * (raw.y - smoothedGaze.y),
            }
          : raw;
        clearGazeCanvas(gazeCtx);
        drawGazeDot(gazeCtx, smoothedGaze);
        const x = Math.round(smoothedGaze.x * window.innerWidth);
        const y = Math.round(smoothedGaze.y * window.innerHeight);
        setStatus(`Gaze: x=${x}, y=${y}`);
      } else {
        // Tracking dropped this frame: keep the last dot, just report it.
        setStatus('Gaze tracking — keep both eyes visible');
      }
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
  gazeModel = null;
  setLiveGaze(false);
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
  setStatus('Requesting camera permission…');
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

  setStatus('Loading face tracker…');
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
  gazeModel = null;
  setLiveGaze(false);
  printBtn.disabled = true;
  calibrateBtn.disabled = true;
  clearGazeCanvas(gazeCtx);
  calibration = startCalibration(performance.now());
  setStatus('Calibration 1 / 9 — get ready…');
});

// Toggles continuous gaze tracking: while on, the render loop redraws the dot
// at the predicted gaze every frame. Click again (or Clear dot) to stop.
printBtn.addEventListener('click', () => {
  if (!gazeModel) {
    setStatus('Run calibration before printing gaze.');
    return;
  }
  if (liveGaze) {
    setLiveGaze(false);
    // Leave the last dot frozen on screen; Clear dot removes it.
    postCalibrationStatus = 'Gaze tracking stopped';
  } else {
    setLiveGaze(true);
    postCalibrationStatus = null;
  }
});

clearBtn.addEventListener('click', () => {
  setLiveGaze(false);
  clearGazeCanvas(gazeCtx);
  // Clear only the dot; keep the calibration / model intact.
  if (gazeModel) postCalibrationStatus = 'Calibrated — ready to print gaze';
  setStatus('Gaze dot cleared');
});

stopBtn.disabled = true;
calibrateBtn.disabled = true;
printBtn.disabled = true;
setStatus('Idle — click "Start camera" to begin');
