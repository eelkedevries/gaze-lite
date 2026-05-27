import './style.css';
import { startCamera } from './camera';
import { createFaceTracker, type FaceTracker } from './faceLandmarks';
import { extractEyeFeatures } from './eyeFeatures';
import { fitGazeModel, type GazeModel } from './gazeModel';
import { startCalibration, updateCalibration, type CalibrationState } from './calibration';
import { clearCanvas, drawHeatmap, drawPreview, resizeCanvasToDisplaySize } from './drawing';
import type { EyeFeatures, FaceTrackingResult } from './types';

// ── Constants ────────────────────────────────────────────────────────────
const GAZE_SMOOTHING = 0.35; // EMA weight for the live dot
const HEAT_MIN_MOVE = 16; // px the gaze must move before a new heat sample
const HEAT_CAP = 220; // max retained heat samples
const POINT_MS = 1500; // visual dwell per calibration point (≈ calibration.ts)
const SANITY_MS = 1500; // collection window per sanity corner
const SANITY_END_MS = 900; // pause before returning to live after sanity
const SANITY_CORNERS = ['tl', 'tr', 'br', 'bl'] as const;
type Corner = (typeof SANITY_CORNERS)[number];

// ── Icons (inline monoline SVG) ──────────────────────────────────────────
const svg = (inner: string): string =>
  `<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const IC_CAMERA = svg('<rect x="2" y="5" width="14" height="10" rx="1.5"/><circle cx="9" cy="10" r="2.6"/><path d="M7 5 L8 3 L10 3 L11 5"/>');
const IC_STOP = svg('<rect x="4.5" y="4.5" width="9" height="9" rx="0.6"/>');
const IC_CALIB = svg('<circle cx="9" cy="9" r="6"/><circle cx="9" cy="9" r="2.5"/><circle cx="9" cy="9" r="0.6" fill="currentColor" stroke="none"/>');
const IC_CORNERS = svg('<path d="M3 6 V3 H6 M12 3 H15 V6 M15 12 V15 H12 M6 15 H3 V12"/>');
const IC_HEAT = svg('<circle cx="6.5" cy="11" r="3.5"/><circle cx="11.5" cy="8" r="2.8"/><circle cx="13.2" cy="12.5" r="1.6"/>');

// ── DOM ──────────────────────────────────────────────────────────────────
function requireEl<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required element: ${selector}`);
  return el;
}

const app = requireEl<HTMLDivElement>('#app');
const video = requireEl<HTMLVideoElement>('#video');
const stage = requireEl<HTMLDivElement>('#stage');
const overlay = requireEl<HTMLCanvasElement>('#overlay');
const heatmap = requireEl<HTMLCanvasElement>('#heatmap');
const gazeDot = requireEl<HTMLDivElement>('#gaze-dot');
const calibLayer = requireEl<HTMLDivElement>('#calib');
const calibDot = requireEl<HTMLSpanElement>('#calib-dot');
const sanityLayer = requireEl<HTMLDivElement>('#sanity');
const idleOverlay = requireEl<HTMLDivElement>('#idle-overlay');
const camTagText = requireEl<HTMLSpanElement>('#cam-tag-text');

const btnCamera = requireEl<HTMLButtonElement>('#btn-camera');
const icCamera = requireEl<HTMLSpanElement>('#ic-camera');
const lbCamera = requireEl<HTMLSpanElement>('#lb-camera');
const btnCalibrate = requireEl<HTMLButtonElement>('#btn-calibrate');
const btnSanity = requireEl<HTMLButtonElement>('#btn-sanity');
const btnHeatmap = requireEl<HTMLButtonElement>('#btn-heatmap');

const roLeft = requireEl<HTMLDivElement>('#ro-left');
const roRight = requireEl<HTMLDivElement>('#ro-right');
const valLeft = requireEl<HTMLSpanElement>('#val-left');
const valRight = requireEl<HTMLSpanElement>('#val-right');
const valFps = requireEl<HTMLSpanElement>('#val-fps');

const logStrip = requireEl<HTMLButtonElement>('#log-strip');
const logDot = requireEl<HTMLSpanElement>('#log-dot');
const logMsg = requireEl<HTMLSpanElement>('#log-msg');
const logTs = requireEl<HTMLSpanElement>('#log-ts');
const logCaret = requireEl<HTMLSpanElement>('#log-caret');
const logBody = requireEl<HTMLDivElement>('#log-body');
const logEntries = requireEl<HTMLDivElement>('#log-entries');
const logClear = requireEl<HTMLButtonElement>('#log-clear');

function getCtx(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context is unavailable');
  return ctx;
}
const overlayCtx = getCtx(overlay);
const heatCtx = getCtx(heatmap);

// Set the static button icons.
btnCalibrate.querySelector('.ic')!.innerHTML = IC_CALIB;
btnSanity.querySelector('.ic')!.innerHTML = IC_CORNERS;
btnHeatmap.querySelector('.ic')!.innerHTML = IC_HEAT;

// ── State ────────────────────────────────────────────────────────────────
type AppState = 'idle' | 'live' | 'calib' | 'sanity';
type Severity = 'ok' | 'warn' | 'err';
interface LogEntry { ts: string; sev: Severity; msg: string }

let state: AppState = 'idle';
let tracker: FaceTracker | null = null;
let gazeModel: GazeModel | null = null;
let calibration: CalibrationState | null = null;
let calibPointStart = 0;

let smoothedGaze: { x: number; y: number } | null = null;
let heatmapOn = false;
const heatSamples: { x: number; y: number }[] = [];

const log: LogEntry[] = [];
let logOpen = false;

// FPS tracking
let fps = 0;
let frameCount = 0;
let fpsWindowStart = performance.now();

// Sanity
let sanityStep = -1;
let sanityBuffer: { x: number; y: number }[] = [];
const sanityDeltas: Partial<Record<Corner, number>> = {};
let sanityTimer: number | undefined;
let sanityEndTimer: number | undefined;

// ── Logging ──────────────────────────────────────────────────────────────
function tsNow(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function addLog(sev: Severity, msg: string): void {
  log.unshift({ ts: tsNow(), sev, msg });
  if (log.length > 120) log.length = 120;
  const latest = log[0];
  logDot.className = `tb-log-dot ${latest.sev}`;
  logMsg.textContent = latest.msg;
  logTs.textContent = latest.ts;
  if (logOpen) renderLogBody();
}

function renderLogBody(): void {
  // Oldest-first source + CSS column-reverse ⇒ newest at the top.
  logEntries.innerHTML = [...log]
    .reverse()
    .map(
      (e) =>
        `<div class="tb-log-entry"><span class="ts">${e.ts}</span>` +
        `<span class="sev ${e.sev}">${e.sev.toUpperCase()}</span>` +
        `<span class="msg">${e.msg}</span></div>`,
    )
    .join('');
}

logStrip.addEventListener('click', () => {
  logOpen = !logOpen;
  logBody.hidden = !logOpen;
  logCaret.textContent = logOpen ? '▴' : '▾';
  logStrip.setAttribute('aria-expanded', String(logOpen));
  if (logOpen) renderLogBody();
});

logClear.addEventListener('click', () => {
  log.length = 0;
  addLog('ok', 'Log cleared');
});

// ── Readouts ─────────────────────────────────────────────────────────────
function qClass(q: number): string {
  return q >= 0.7 ? 'good' : q >= 0.45 ? 'warn' : 'err';
}

function updateReadouts(features: EyeFeatures | null): void {
  if (state === 'idle') {
    valLeft.textContent = '—';
    valRight.textContent = '—';
    valFps.textContent = '—';
    roLeft.className = 'tb-readout';
    roRight.className = 'tb-readout';
    return;
  }
  valFps.textContent = String(fps);
  if (features) {
    valLeft.textContent = String(Math.round(features.leftQuality * 100));
    valRight.textContent = String(Math.round(features.rightQuality * 100));
    roLeft.className = `tb-readout ${qClass(features.leftQuality)}`;
    roRight.className = `tb-readout ${qClass(features.rightQuality)}`;
  } else {
    valLeft.textContent = '—';
    valRight.textContent = '—';
    roLeft.className = 'tb-readout';
    roRight.className = 'tb-readout';
  }
}

// ── Buttons / state ──────────────────────────────────────────────────────
function renderButtons(): void {
  const live = state !== 'idle';
  icCamera.innerHTML = live ? IC_STOP : IC_CAMERA;
  lbCamera.textContent = live ? 'Stop' : 'Camera';
  btnCamera.className = `tb-btn ${live ? 'danger' : 'primary'}`;

  btnCalibrate.disabled = state !== 'live';
  btnSanity.disabled = state !== 'live' || !gazeModel;
  btnHeatmap.disabled = !live;
  btnHeatmap.className = `tb-btn${heatmapOn ? ' active' : ''}`;
}

function setState(next: AppState): void {
  state = next;
  app.classList.toggle('calibrating', next === 'calib');
  idleOverlay.classList.toggle('hidden', next !== 'idle');
  calibLayer.hidden = next !== 'calib';
  sanityLayer.hidden = next !== 'sanity';
  camTagText.textContent = next === 'idle' ? 'STANDBY' : 'CAM 01';
  if (next === 'idle' || next === 'calib') hideGazeDot();
  renderButtons();
}

function hideGazeDot(): void {
  gazeDot.classList.add('hidden');
}

// ── Heatmap ──────────────────────────────────────────────────────────────
function resizeHeatmap(): void {
  resizeCanvasToDisplaySize(heatmap, window.innerWidth, window.innerHeight, 2);
}

function maybeAddHeatSample(x: number, y: number): void {
  if (!heatmapOn) return;
  const last = heatSamples[heatSamples.length - 1];
  if (!last || Math.hypot(last.x - x, last.y - y) > HEAT_MIN_MOVE) {
    heatSamples.push({ x, y });
    if (heatSamples.length > HEAT_CAP) heatSamples.shift();
    drawHeatmap(heatCtx, heatSamples);
  }
}

// ── Live gaze dot ────────────────────────────────────────────────────────
function showGaze(features: EyeFeatures): void {
  if (!gazeModel) {
    hideGazeDot();
    return;
  }
  const raw = gazeModel.predict(features.featureVector);
  const target = { x: raw.x * window.innerWidth, y: raw.y * window.innerHeight };
  smoothedGaze = smoothedGaze
    ? {
        x: smoothedGaze.x + GAZE_SMOOTHING * (target.x - smoothedGaze.x),
        y: smoothedGaze.y + GAZE_SMOOTHING * (target.y - smoothedGaze.y),
      }
    : target;
  gazeDot.style.left = `${smoothedGaze.x}px`;
  gazeDot.style.top = `${smoothedGaze.y}px`;
  gazeDot.classList.remove('hidden');
  maybeAddHeatSample(smoothedGaze.x, smoothedGaze.y);
  if (state === 'sanity' && sanityStep >= 0) {
    sanityBuffer.push({ x: smoothedGaze.x, y: smoothedGaze.y });
  }
}

// ── Calibration ──────────────────────────────────────────────────────────
function renderCalibDot(): void {
  if (!calibration) return;
  const pt = calibration.points[calibration.index];
  const elapsed = performance.now() - calibPointStart;
  const s = Math.max(0, 1 - elapsed / POINT_MS);
  calibDot.style.left = `${pt.x * window.innerWidth}px`;
  calibDot.style.top = `${pt.y * window.innerHeight}px`;
  calibDot.style.transform = `translate(-50%, -50%) scale(${s})`;
}

function finishCalibration(samples: CalibrationState['samples']): void {
  try {
    gazeModel = fitGazeModel(samples);
    addLog('ok', `Calibration complete · ${samples.length}/${samples.length} points`);
  } catch (err) {
    gazeModel = null;
    addLog('err', `Calibration failed · ${err instanceof Error ? err.message : 'fit error'}`);
  }
  calibration = null;
  smoothedGaze = null;
  setState('live');
}

// ── Sanity check ─────────────────────────────────────────────────────────
function cornerCenter(c: Corner): { x: number; y: number } {
  // Read the actual marker position so it stays correct wherever CSS places it.
  const el = sanityLayer.querySelector<HTMLElement>(`.corner.${c}`);
  if (!el) return { x: 0, y: 0 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function setCornerActive(c: Corner | null): void {
  for (const cc of SANITY_CORNERS) {
    sanityLayer.querySelector(`.corner.${cc}`)!.classList.toggle('active', cc === c);
  }
}

function setCornerDelta(c: Corner, delta: number | null): void {
  requireEl<HTMLSpanElement>(`#sanity-${c}`).textContent = delta == null ? 'Δ —' : `Δ ${delta}px`;
}

function startSanity(): void {
  if (!gazeModel) return;
  setState('sanity');
  for (const c of SANITY_CORNERS) {
    setCornerDelta(c, null);
    delete sanityDeltas[c];
  }
  addLog('ok', 'Sanity check started · look at each corner');
  sanityStep = 0;
  sanityBuffer = [];
  setCornerActive(SANITY_CORNERS[0]);

  sanityTimer = window.setInterval(() => {
    const c = SANITY_CORNERS[sanityStep];
    if (sanityBuffer.length) {
      const avg = sanityBuffer.reduce(
        (a, p) => ({ x: a.x + p.x, y: a.y + p.y }),
        { x: 0, y: 0 },
      );
      avg.x /= sanityBuffer.length;
      avg.y /= sanityBuffer.length;
      const tgt = cornerCenter(c);
      const delta = Math.round(Math.hypot(avg.x - tgt.x, avg.y - tgt.y));
      sanityDeltas[c] = delta;
      setCornerDelta(c, delta);
    }
    sanityBuffer = [];
    sanityStep += 1;
    if (sanityStep >= SANITY_CORNERS.length) {
      window.clearInterval(sanityTimer);
      setCornerActive(null);
      const vals = Object.values(sanityDeltas);
      const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
      addLog('ok', `Sanity check complete · avg ${avg}px deviation`);
      sanityEndTimer = window.setTimeout(() => {
        sanityStep = -1;
        if (state === 'sanity') setState('live');
      }, SANITY_END_MS);
    } else {
      setCornerActive(SANITY_CORNERS[sanityStep]);
    }
  }, SANITY_MS);
}

function cancelSanity(): void {
  window.clearInterval(sanityTimer);
  window.clearTimeout(sanityEndTimer);
  sanityStep = -1;
  sanityBuffer = [];
  setCornerActive(null);
}

// ── Detection loop ───────────────────────────────────────────────────────
function updateFps(now: number): void {
  frameCount += 1;
  const dt = now - fpsWindowStart;
  if (dt >= 500) {
    fps = Math.round((frameCount * 1000) / dt);
    frameCount = 0;
    fpsWindowStart = now;
  }
}

const detectLoop = (): void => {
  if (state === 'idle' || !tracker) return;
  const now = performance.now();
  updateFps(now);

  let features: EyeFeatures | null = null;
  let result: FaceTrackingResult | null = null;
  if (video.readyState >= 2 && video.videoWidth > 0) {
    result = tracker.detect(video, now);
    clearCanvas(overlayCtx);
    if (!result.error && result.hasFace) {
      const f = extractEyeFeatures(result);
      if (f && f.confidence > 0) {
        features = f;
        drawPreview(overlayCtx, f, result.landmarks, video.videoWidth, video.videoHeight, true);
      }
    }
  }

  updateReadouts(features);

  if (state === 'calib' && calibration) {
    updateCalibration(calibration, now, features);
    if (calibration.index !== lastCalibIndex) {
      lastCalibIndex = calibration.index;
      calibPointStart = now;
    }
    if (calibration.phase === 'complete') {
      finishCalibration(calibration.samples);
    } else if (calibration.phase === 'failed') {
      const msg = calibration.error ?? 'not enough samples';
      calibration = null;
      addLog('err', `Calibration failed · ${msg}`);
      setState('live');
    } else {
      renderCalibDot();
    }
  } else if (features) {
    showGaze(features);
  } else if (state !== 'calib') {
    hideGazeDot();
  }

  requestAnimationFrame(detectLoop);
};

let lastCalibIndex = -1;

// ── Actions ──────────────────────────────────────────────────────────────
async function handleStart(): Promise<void> {
  if (state !== 'idle') return;
  btnCamera.disabled = true;
  addLog('ok', 'Requesting camera permission…');
  try {
    await startCamera(video);
  } catch (err) {
    addLog('err', err instanceof Error ? err.message : 'Camera failed to start.');
    btnCamera.disabled = false;
    return;
  }
  btnCamera.disabled = false;
  resizeOverlay();
  setState('live');
  addLog('ok', `Camera ${video.videoWidth || '—'}×${video.videoHeight || '—'} acquired · loading face tracker…`);
  try {
    tracker = await createFaceTracker();
    addLog('ok', 'MediaPipe FaceLandmarker loaded · calibrate to begin');
    requestAnimationFrame(detectLoop);
  } catch (err) {
    addLog('err', `Face tracker error · ${err instanceof Error ? err.message : 'failed to load'}`);
  }
}

function handleStop(): void {
  if (state === 'idle') return;
  cancelSanity();
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  tracker?.close();
  tracker = null;
  gazeModel = null;
  calibration = null;
  smoothedGaze = null;
  heatmapOn = false;
  heatSamples.length = 0;
  clearCanvas(heatCtx);
  clearCanvas(overlayCtx);
  setState('idle');
  updateReadouts(null);
  addLog('warn', 'Camera released · tracking stopped');
}

function handleCalibrate(): void {
  if (state !== 'live' || !tracker) return;
  addLog('ok', 'Starting 9-point calibration · look at each target');
  gazeModel = null;
  smoothedGaze = null;
  lastCalibIndex = 0;
  calibPointStart = performance.now();
  calibration = startCalibration(performance.now());
  setState('calib');
  renderCalibDot();
}

function handleSanity(): void {
  if (state !== 'live' || !gazeModel) return;
  startSanity();
}

function handleHeatmapToggle(): void {
  if (state === 'idle') return;
  heatmapOn = !heatmapOn;
  if (!heatmapOn) {
    heatSamples.length = 0;
    clearCanvas(heatCtx);
    addLog('ok', 'Heatmap cleared');
  } else {
    addLog('ok', 'Heatmap accumulation enabled');
  }
  renderButtons();
}

btnCamera.addEventListener('click', () => {
  if (state === 'idle') void handleStart();
  else handleStop();
});
btnCalibrate.addEventListener('click', handleCalibrate);
btnSanity.addEventListener('click', handleSanity);
btnHeatmap.addEventListener('click', handleHeatmapToggle);

// ── Keyboard shortcuts ───────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement | null)?.tagName ?? '';
  if (/input|textarea|select/i.test(tag)) return;
  const k = e.key.toLowerCase();
  if (k === 's' && state === 'idle') void handleStart();
  else if (k === 'c' && state === 'live') handleCalibrate();
  else if (k === 'v' && state === 'live') handleSanity();
  else if (k === 'h' && state !== 'idle') handleHeatmapToggle();
  else if (e.key === 'Escape' && state !== 'idle') handleStop();
});

// ── Resize ───────────────────────────────────────────────────────────────
function resizeOverlay(): void {
  const r = stage.getBoundingClientRect();
  resizeCanvasToDisplaySize(overlay, r.width, r.height);
}

function onViewportChange(): void {
  resizeOverlay();
  resizeHeatmap();
  if (heatmapOn) {
    heatSamples.length = 0;
    clearCanvas(heatCtx);
  }
  // A resize / orientation change moves screen coordinates, so a fitted model
  // no longer maps correctly — drop it and ask for a recalibration.
  if (gazeModel && state !== 'calib') {
    gazeModel = null;
    smoothedGaze = null;
    hideGazeDot();
    addLog('warn', 'Viewport changed · recalibrate to continue');
    renderButtons();
  }
}

window.addEventListener('resize', onViewportChange);
window.addEventListener('orientationchange', onViewportChange);
new ResizeObserver(resizeOverlay).observe(stage);

// ── Init ─────────────────────────────────────────────────────────────────
resizeHeatmap();
resizeOverlay();
setState('idle');
addLog('ok', 'gaze-lite ready · no camera initialised');
