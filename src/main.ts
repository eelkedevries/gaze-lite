import './style.css';
import { startCamera } from './camera';

// Initial GUI wiring: camera start, status handling, and canvas sizing.
// MediaPipe, eye boxes, calibration, and gaze prediction are not wired up yet.

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

function setStatus(message: string): void {
  statusEl.textContent = message;
}

// Size a canvas's backing store to a CSS display size, scaled by the device
// pixel ratio so future drawing stays crisp on high-DPI and mobile screens.
function sizeCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): void {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(cssWidth * dpr));
  const h = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function resizeGazeCanvas(): void {
  sizeCanvas(gazeCanvas, window.innerWidth, window.innerHeight);
}

function resizeOverlay(): void {
  const rect = video.getBoundingClientRect();
  sizeCanvas(overlay, rect.width, rect.height);
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
