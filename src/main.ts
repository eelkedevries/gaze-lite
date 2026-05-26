import './style.css';
import { startCamera } from './camera';
import { createFaceTracker, type FaceTracker } from './faceLandmarks';
import { extractEyeFeatures } from './eyeFeatures';
import { clearPreviewOverlay, drawEyeBoxes, resizeCanvasToDisplaySize } from './drawing';
import type { EyeFeatures, FaceTrackingResult } from './types';

// GUI wiring: camera start, face tracking, and green eye boxes on the preview.
// Calibration and gaze prediction are not wired up yet.

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
const calibrateBtn = requireEl<HTMLButtonElement>('#btn-calibrate');
const printBtn = requireEl<HTMLButtonElement>('#btn-print');
const clearBtn = requireEl<HTMLButtonElement>('#btn-clear');

const gazeCtx = gazeCanvas.getContext('2d');
if (!gazeCtx) throw new Error('2D canvas context is unavailable');
const overlayCtx = overlay.getContext('2d');
if (!overlayCtx) throw new Error('2D canvas context is unavailable');

function setStatus(message: string): void {
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
let tracker: FaceTracker | null = null;
let latestResult: FaceTrackingResult | null = null;
// Last frame where both eyes were cleanly tracked; kept for calibration later.
let latestEyeFeatures: EyeFeatures | null = null;

// Only push to the DOM when the message changes, so the rAF loop doesn't
// rewrite the status line every frame.
let lastStatus = '';
function setTrackerStatus(message: string): void {
  if (message === lastStatus) return;
  lastStatus = message;
  setStatus(message);
}

/** Latest frame's valid eye features, for calibration in the next step. */
export function getLatestEyeFeatures(): EyeFeatures | null {
  return latestEyeFeatures;
}

const detectLoop = (): void => {
  if (tracker && video.readyState >= 2 && video.videoWidth > 0) {
    latestResult = tracker.detect(video, performance.now());
    clearPreviewOverlay(overlayCtx);

    if (latestResult.error) {
      setTrackerStatus(`Face tracker error: ${latestResult.error}`);
    } else if (!latestResult.hasFace) {
      setTrackerStatus('No face detected');
    } else {
      const features = extractEyeFeatures(latestResult);
      if (features && features.confidence > 0) {
        latestEyeFeatures = features;
        drawEyeBoxes(overlayCtx, features, {
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          mirror: true,
        });
        setTrackerStatus('Both eyes tracked');
      } else {
        setTrackerStatus('Face detected, eyes not stable');
      }
    }
  }
  requestAnimationFrame(detectLoop);
}

startBtn.addEventListener('click', async () => {
  if (cameraStarted) return;
  startBtn.disabled = true;
  setStatus('Starting camera…');
  try {
    await startCamera(video);
    cameraStarted = true;
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
    requestAnimationFrame(detectLoop);
  } catch (err) {
    setStatus(`Face tracker error: ${err instanceof Error ? err.message : 'failed to load'}`);
  }
});

calibrateBtn.addEventListener('click', () => {
  setStatus('Calibration not implemented yet');
});

printBtn.addEventListener('click', () => {
  setStatus('Gaze model not implemented yet');
});

clearBtn.addEventListener('click', () => {
  gazeCtx.clearRect(0, 0, gazeCanvas.width, gazeCanvas.height);
  setStatus('Gaze dot cleared');
});

setStatus('Idle — click "Start camera" to begin');
