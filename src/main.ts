import './style.css';
import { startCamera } from './camera';
import { createFaceTracker, type FaceTracker } from './faceLandmarks';
import { extractEyeFeatures, FEATURE_VERSION } from './eyeFeatures';
import { fitGazeModel, type GazeModel } from './gazeModel';
import {
  POINT_TOTAL_MS,
  startCalibration,
  sweepTarget,
  SWEEP_MS,
  updateCalibration,
  type CalibrationState,
} from './calibration';
import { clearCanvas, drawHeatmap, drawPreview, resizeCanvasToDisplaySize } from './drawing';
import { AutoFramer, coverCrop } from './autoFrame';
import { OneEuroFilter2D } from './filters';
import { loadCalibration, saveCalibration } from './persistence';
import { radToDeg } from './headPose';
import type { EyeFeatures, FaceTrackingResult, FrameCrop } from './types';

// ── Constants ────────────────────────────────────────────────────────────
// One Euro filter for the live dot (screen-pixel units at ~30 Hz): minCutoff
// sets fixation steadiness, beta opens the filter during saccades.
const GAZE_FILTER = { minCutoff: 0.8, beta: 0.008, dCutoff: 1.0 };
const FACE_LOST_HIDE_MS = 600; // hide the dot after this long without eyes
const HEAT_MIN_MOVE = 16; // px the gaze must move before a new heat sample
const HEAT_CAP = 220; // max retained heat samples

// Validation: fixation points (normalized) checked against the fitted model.
const VALIDATE_POINTS = [
  { x: 0.5, y: 0.5, label: 'Centre' },
  { x: 0.15, y: 0.18, label: 'Top-left' },
  { x: 0.85, y: 0.18, label: 'Top-right' },
  { x: 0.15, y: 0.82, label: 'Bottom-left' },
  { x: 0.85, y: 0.82, label: 'Bottom-right' },
];
const V_DWELL_MS = 450; // settle before sampling
const V_COLLECT_MS = 900; // sampling window per point

// ── Icons (inline monoline SVG) ──────────────────────────────────────────
const svg = (inner: string): string =>
  `<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const IC_CAMERA = svg('<rect x="2" y="5" width="14" height="10" rx="1.5"/><circle cx="9" cy="10" r="2.6"/><path d="M7 5 L8 3 L10 3 L11 5"/>');
const IC_STOP = svg('<rect x="4.5" y="4.5" width="9" height="9" rx="0.6"/>');
const IC_CALIB = svg('<circle cx="9" cy="9" r="6"/><circle cx="9" cy="9" r="2.5"/><circle cx="9" cy="9" r="0.6" fill="currentColor" stroke="none"/>');
const IC_VALIDATE = svg('<circle cx="9" cy="9" r="6"/><path d="M6.3 9.2 L8.1 11 L11.6 6.8"/>');
const IC_HEAT = svg('<circle cx="6.5" cy="11" r="3.5"/><circle cx="11.5" cy="8" r="2.8"/><circle cx="13.2" cy="12.5" r="1.6"/>');
const IC_FRAME = svg('<path d="M2 6 V3.5 A1.5 1.5 0 0 1 3.5 2 H6 M12 2 H14.5 A1.5 1.5 0 0 1 16 3.5 V6 M16 12 V14.5 A1.5 1.5 0 0 1 14.5 16 H12 M6 16 H3.5 A1.5 1.5 0 0 1 2 14.5 V12"/><circle cx="9" cy="9" r="2.2"/>');
const IC_DOCK_UP = svg('<path d="M9 13 V5 M5.5 8.5 L9 5 L12.5 8.5"/>');
const IC_DOCK_DOWN = svg('<path d="M9 5 V13 M5.5 9.5 L9 13 L12.5 9.5"/>');

// ── DOM ──────────────────────────────────────────────────────────────────
function requireEl<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required element: ${selector}`);
  return el;
}

const app = requireEl<HTMLDivElement>('#app');
const toolbar = requireEl<HTMLDivElement>('#toolbar');
const video = requireEl<HTMLVideoElement>('#video');
const stage = requireEl<HTMLDivElement>('#stage');
const overlay = requireEl<HTMLCanvasElement>('#overlay');
const heatmap = requireEl<HTMLCanvasElement>('#heatmap');
const gazeDot = requireEl<HTMLDivElement>('#gaze-dot');
const calibLayer = requireEl<HTMLDivElement>('#calib');
const calibDot = requireEl<HTMLSpanElement>('#calib-dot');
const calibHint = requireEl<HTMLDivElement>('#calib-hint');
const validateLayer = requireEl<HTMLDivElement>('#validate');
const validateDot = requireEl<HTMLSpanElement>('#validate-dot');
const validateRing = requireEl<HTMLSpanElement>('#validate-ring');
const results = requireEl<HTMLDivElement>('#results');
const resultsRows = requireEl<HTMLDivElement>('#results-rows');
const resultsSummary = requireEl<HTMLDivElement>('#results-summary');
const resultsDone = requireEl<HTMLButtonElement>('#results-done');
const idleOverlay = requireEl<HTMLDivElement>('#idle-overlay');
const camTagText = requireEl<HTMLSpanElement>('#cam-tag-text');

const btnCamera = requireEl<HTMLButtonElement>('#btn-camera');
const icCamera = requireEl<HTMLSpanElement>('#ic-camera');
const lbCamera = requireEl<HTMLSpanElement>('#lb-camera');
const btnCalibrate = requireEl<HTMLButtonElement>('#btn-calibrate');
const btnValidate = requireEl<HTMLButtonElement>('#btn-validate');
const btnHeatmap = requireEl<HTMLButtonElement>('#btn-heatmap');
const btnFrame = requireEl<HTMLButtonElement>('#btn-frame');
const btnDock = requireEl<HTMLButtonElement>('#btn-dock');
const icDock = requireEl<HTMLSpanElement>('#ic-dock');

const roLeft = requireEl<HTMLDivElement>('#ro-left');
const roRight = requireEl<HTMLDivElement>('#ro-right');
const valLeft = requireEl<HTMLSpanElement>('#val-left');
const valRight = requireEl<HTMLSpanElement>('#val-right');
const valHead = requireEl<HTMLSpanElement>('#val-head');
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

// Static button icons.
btnCalibrate.querySelector('.ic')!.innerHTML = IC_CALIB;
btnValidate.querySelector('.ic')!.innerHTML = IC_VALIDATE;
btnHeatmap.querySelector('.ic')!.innerHTML = IC_HEAT;
btnFrame.querySelector('.ic')!.innerHTML = IC_FRAME;

// ── State ────────────────────────────────────────────────────────────────
type AppState = 'idle' | 'live' | 'calib' | 'validate';
type Severity = 'ok' | 'warn' | 'err';
interface LogEntry { ts: string; sev: Severity; msg: string }

let state: AppState = 'idle';
let tracker: FaceTracker | null = null;
let trackerRestarting = false;
let loopRunning = false;
let gazeModel: GazeModel | null = null;
let calibration: CalibrationState | null = null;
let calibPointStart = 0;
let lastCalibIndex = -1;

const gazeFilter = new OneEuroFilter2D(GAZE_FILTER);
let lastGazeMs = -Infinity; // last time the dot got a fresh, eyes-open update
let heatmapOn = false;
const heatSamples: { x: number; y: number }[] = [];
let dockTop = false;

// Auto-framing (keep the eyes centred in the preview).
const autoFramer = new AutoFramer();
let frameOn = true;
let stageCssW = 0;
let stageCssH = 0;
let videoCssW = 0;
let videoCssH = 0;

// New-camera-frame gating: detection runs once per delivered frame, not per
// rAF tick (a 30 fps camera under a 60–120 Hz rAF would otherwise re-infer
// duplicate frames).
const supportsRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
let frameReady = false;
let rvfcHandle = 0;
let lastVideoTime = -1;
let latestFeatures: EyeFeatures | null = null;
let latestResult: FaceTrackingResult | null = null;

// Validation
let vIndex = 0;
let vPhase: 'dwell' | 'collect' = 'dwell';
let vPointStart = 0;
let vBuffer: { x: number; y: number }[] = [];
let vResults: { label: string; dev: number }[] = [];

const log: LogEntry[] = [];
let logOpen = false;

// FPS (counts detection frames, i.e. delivered camera frames)
let fps = 0;
let frameCount = 0;
let fpsWindowStart = performance.now();

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

function formatHead(features: EyeFeatures): string {
  const pose = features.headPose;
  if (!pose) return '—';
  const f = (rad: number): string => {
    const deg = Math.round(radToDeg(rad));
    return `${deg > 0 ? '+' : ''}${deg}°`;
  };
  return `${f(pose.yaw)} ${f(pose.pitch)}`;
}

function updateReadouts(features: EyeFeatures | null): void {
  if (state === 'idle') {
    valLeft.textContent = '—';
    valRight.textContent = '—';
    valHead.textContent = '—';
    valFps.textContent = '—';
    roLeft.className = 'tb-readout';
    roRight.className = 'tb-readout';
    return;
  }
  valFps.textContent = String(fps);
  if (features) {
    valLeft.textContent = String(Math.round(features.leftQuality * 100));
    valRight.textContent = String(Math.round(features.rightQuality * 100));
    valHead.textContent = formatHead(features);
    roLeft.className = `tb-readout ${qClass(features.leftQuality)}`;
    roRight.className = `tb-readout ${qClass(features.rightQuality)}`;
  } else {
    valLeft.textContent = '—';
    valRight.textContent = '—';
    valHead.textContent = '—';
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
  btnValidate.disabled = state !== 'live' || !gazeModel;
  btnHeatmap.disabled = !live;
  btnHeatmap.className = `tb-btn${heatmapOn ? ' active' : ''}`;
  btnFrame.disabled = !live;
  btnFrame.className = `tb-btn${frameOn ? ' active' : ''}`;
}

function setState(next: AppState): void {
  state = next;
  app.classList.toggle('calibrating', next === 'calib');
  app.classList.toggle('validating', next === 'validate');
  idleOverlay.classList.toggle('hidden', next !== 'idle');
  calibLayer.hidden = next !== 'calib';
  if (next !== 'calib') calibHint.hidden = true;
  validateLayer.hidden = next !== 'validate';
  if (next !== 'validate') results.hidden = true;
  camTagText.textContent = next === 'idle' ? 'STANDBY' : 'CAM 01';
  if (next !== 'live') hideGazeDot();
  renderButtons();
}

function hideGazeDot(): void {
  gazeDot.classList.add('hidden');
}

function applyDock(): void {
  toolbar.classList.toggle('dock-top', dockTop);
  icDock.innerHTML = dockTop ? IC_DOCK_DOWN : IC_DOCK_UP;
  btnDock.title = dockTop ? 'Move toolbar to bottom' : 'Move toolbar to top';
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

// ── Auto-framing (digital pan/zoom keeping the eyes centred) ─────────────
function applyVideoCrop(crop: FrameCrop): void {
  if (stageCssW <= 0 || crop.width <= 0 || video.videoWidth === 0) return;
  // Keep the element at the stream's intrinsic size (re-checked because
  // rotating a phone can restart the track at swapped dimensions).
  if (videoCssW !== video.videoWidth || videoCssH !== video.videoHeight) {
    videoCssW = video.videoWidth;
    videoCssH = video.videoHeight;
    video.style.width = `${videoCssW}px`;
    video.style.height = `${videoCssH}px`;
  }
  const k = stageCssW / crop.width;
  video.style.transform = `translate(${-crop.x * k}px, ${-crop.y * k}px) scale(${k})`;
}

function updateFraming(features: EyeFeatures | null, now: number): FrameCrop {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const aspect = stageCssH > 0 ? stageCssW / stageCssH : 4;
  if (vw === 0 || vh === 0) return { x: 0, y: 0, width: 1, height: 1 };
  const crop = frameOn
    ? autoFramer.update(
        features ? features.faceCenter : null,
        features ? features.faceScale : null,
        vw,
        vh,
        aspect,
        now,
      )
    : coverCrop(vw, vh, aspect);
  applyVideoCrop(crop);
  return crop;
}

// ── Live gaze dot ────────────────────────────────────────────────────────
function predictGazePx(features: EyeFeatures): { x: number; y: number } | null {
  if (!gazeModel) return null;
  const raw = gazeModel.predict(features.featureVector);
  return { x: raw.x * window.innerWidth, y: raw.y * window.innerHeight };
}

function showGaze(features: EyeFeatures | null, now: number): void {
  // During a blink (or a tracking dropout) hold the dot rather than letting
  // it jump: lid-covered irises produce garbage gaze, not data.
  if (!features || !features.eyesOpen) {
    if (now - lastGazeMs > FACE_LOST_HIDE_MS) hideGazeDot();
    return;
  }
  const target = predictGazePx(features);
  if (!target) {
    hideGazeDot();
    return;
  }
  lastGazeMs = now;
  const smoothed = gazeFilter.filter(target.x, target.y, now);
  gazeDot.style.transform = `translate3d(${smoothed.x}px, ${smoothed.y}px, 0) translate(-50%, -50%)`;
  gazeDot.classList.remove('hidden');
  maybeAddHeatSample(smoothed.x, smoothed.y);
}

// ── Calibration ──────────────────────────────────────────────────────────
function renderCalibDot(now: number): void {
  if (!calibration) return;
  const phase = calibration.phase;
  if (phase === 'sweepIntro' || phase === 'sweep') {
    const pt = sweepTarget(calibration);
    calibDot.style.left = `${pt.x * window.innerWidth}px`;
    calibDot.style.top = `${pt.y * window.innerHeight}px`;
    // Gentle pulse so the target reads "hold here" instead of "about to end".
    const s = 0.55 + 0.08 * Math.sin((now / 600) * Math.PI);
    calibDot.style.transform = `translate(-50%, -50%) scale(${s})`;

    calibHint.hidden = false;
    const remaining =
      phase === 'sweep'
        ? Math.max(0, Math.ceil((SWEEP_MS - (now - calibration.phaseStart)) / 1000))
        : Math.ceil(SWEEP_MS / 1000);
    calibHint.innerHTML =
      'Keep looking at the dot' +
      `<span class="calib-hint-sub">slowly turn &amp; move your head · ${remaining}s</span>`;
    return;
  }

  calibHint.hidden = true;
  const pt = calibration.points[calibration.index];
  if (!pt) return;
  const elapsed = now - calibPointStart;
  // Shrink toward a small nub (not zero): on slow devices the collect window
  // extends past the nominal dwell and the user still needs a fixation target.
  const s = Math.max(0.22, 1 - elapsed / POINT_TOTAL_MS);
  calibDot.style.left = `${pt.x * window.innerWidth}px`;
  calibDot.style.top = `${pt.y * window.innerHeight}px`;
  calibDot.style.transform = `translate(-50%, -50%) scale(${s})`;
}

function finishCalibration(calib: CalibrationState): void {
  try {
    gazeModel = fitGazeModel(calib.samples);
    saveCalibration(FEATURE_VERSION, calib.samples);
    const diag = Math.hypot(window.innerWidth, window.innerHeight);
    const cvPx = Math.round(
      Math.hypot(
        gazeModel.cvRmse.x * window.innerWidth,
        gazeModel.cvRmse.y * window.innerHeight,
      ),
    );
    const sweepNote = calib.sweepFrames > 0 ? `head sweep ${calib.sweepFrames} frames` : 'no head sweep';
    addLog(
      'ok',
      `Calibration complete · ${calib.samples.length} samples · ${sweepNote} · est. error ≈ ${cvPx} px (${((cvPx / diag) * 100).toFixed(1)}%)`,
    );
    if (calib.warning) addLog('warn', calib.warning);
  } catch (err) {
    gazeModel = null;
    addLog('err', `Calibration failed · ${err instanceof Error ? err.message : 'fit error'}`);
  }
  calibration = null;
  gazeFilter.reset();
  lastGazeMs = -Infinity;
  setState('live');
}

/** Refits the model from samples persisted for this exact viewport, if any. */
function restoreCalibration(): boolean {
  const stored = loadCalibration(FEATURE_VERSION);
  if (!stored) return false;
  try {
    gazeModel = fitGazeModel(stored.samples);
  } catch {
    return false;
  }
  gazeFilter.reset();
  lastGazeMs = -Infinity;
  const age = Math.round((Date.now() - stored.savedAt) / 60000);
  addLog(
    'ok',
    `Calibration restored (${age < 1 ? 'just saved' : `${age} min old`}) · validate to verify, or recalibrate`,
  );
  renderButtons();
  return true;
}

// ── Validation ───────────────────────────────────────────────────────────
function renderValidateTarget(now: number): void {
  const pt = VALIDATE_POINTS[vIndex];
  if (!pt) return; // validation finished; results screen is up
  const x = pt.x * window.innerWidth;
  const y = pt.y * window.innerHeight;
  for (const el of [validateDot, validateRing]) {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }
  const prog = Math.min(1, (now - vPointStart) / (V_DWELL_MS + V_COLLECT_MS));
  validateRing.style.transform = `translate(-50%, -50%) scale(${1 + (1 - prog) * 0.6})`;
}

function runValidateFrame(now: number, features: EyeFeatures | null): void {
  if (vIndex >= VALIDATE_POINTS.length) return; // done; results showing
  const elapsed = now - vPointStart;
  if (vPhase === 'dwell') {
    if (elapsed >= V_DWELL_MS) {
      vPhase = 'collect';
      vBuffer = [];
    }
  } else {
    if (features && features.eyesOpen) {
      const g = predictGazePx(features);
      if (g) vBuffer.push(g);
    }
    if (elapsed >= V_DWELL_MS + V_COLLECT_MS) {
      const pt = VALIDATE_POINTS[vIndex];
      const tgt = { x: pt.x * window.innerWidth, y: pt.y * window.innerHeight };
      let dev = NaN;
      if (vBuffer.length) {
        const avg = vBuffer.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
        avg.x /= vBuffer.length;
        avg.y /= vBuffer.length;
        dev = Math.hypot(avg.x - tgt.x, avg.y - tgt.y);
      }
      vResults.push({ label: pt.label, dev });
      vIndex += 1;
      if (vIndex >= VALIDATE_POINTS.length) {
        finishValidation();
        return;
      }
      vPhase = 'dwell';
      vPointStart = now;
    }
  }
  renderValidateTarget(now);
}

function finishValidation(): void {
  validateLayer.hidden = true;
  const devs = vResults.map((r) => r.dev).filter((d) => Number.isFinite(d));
  const avg = devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : NaN;
  const diag = Math.hypot(window.innerWidth, window.innerHeight);
  const pct = Number.isFinite(avg) ? (avg / diag) * 100 : NaN;

  resultsRows.innerHTML = vResults
    .map(
      (r) =>
        `<div class="results-row"><span class="lbl">${r.label}</span>` +
        `<span class="dev">${Number.isFinite(r.dev) ? `Δ ${Math.round(r.dev)} px` : 'no data'}</span></div>`,
    )
    .join('');

  let verdict: Severity = 'err';
  if (Number.isFinite(avg)) {
    if (avg < diag * 0.035) verdict = 'ok';
    else if (avg < diag * 0.075) verdict = 'warn';
  }
  resultsSummary.className = `results-summary ${verdict === 'ok' ? 'good' : verdict}`;
  resultsSummary.textContent = Number.isFinite(avg)
    ? `Average deviation Δ ${Math.round(avg)} px · ${pct.toFixed(1)}% of screen`
    : 'No gaze samples collected — check tracking and retry.';

  results.hidden = false;
  addLog(verdict, Number.isFinite(avg)
    ? `Validation complete · avg Δ ${Math.round(avg)} px (${pct.toFixed(1)}%)`
    : 'Validation complete · no samples collected');
}

function resetValidation(): void {
  vIndex = VALIDATE_POINTS.length;
  vBuffer = [];
  vResults = [];
  validateLayer.hidden = true;
  results.hidden = true;
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

function armFrameCallback(): void {
  if (!supportsRVFC || state === 'idle') return;
  rvfcHandle = video.requestVideoFrameCallback(() => {
    frameReady = true;
    armFrameCallback();
  });
}

// MediaPipe graphs don't recover from in-graph errors; rebuild the tracker.
async function restartTracker(): Promise<void> {
  if (trackerRestarting) return;
  trackerRestarting = true;
  tracker?.close();
  tracker = null;
  addLog('warn', 'Face tracker fault · restarting…');
  try {
    const next = await createFaceTracker();
    if (state === 'idle') {
      next.close(); // the user stopped the camera while we were rebuilding
    } else {
      tracker = next;
      addLog('ok', `Face tracker restarted (${next.delegate})`);
    }
  } catch (err) {
    addLog('err', `Face tracker error · ${err instanceof Error ? err.message : 'failed to load'}`);
  } finally {
    trackerRestarting = false;
  }
}

const detectLoop = (): void => {
  if (state === 'idle') {
    loopRunning = false;
    return;
  }
  const now = performance.now();

  // Run detection only when the camera delivered a new frame.
  const hasNewFrame = supportsRVFC
    ? frameReady
    : video.currentTime !== lastVideoTime;
  frameReady = false;
  lastVideoTime = video.currentTime;

  if (tracker && hasNewFrame && video.readyState >= 2 && video.videoWidth > 0) {
    updateFps(now);
    const result: FaceTrackingResult = tracker.detect(video, now);
    latestResult = result;
    if (!result.error && result.hasFace) {
      const f = extractEyeFeatures(result, video.videoWidth / video.videoHeight);
      latestFeatures = f && f.confidence > 0 ? f : null;
    } else {
      latestFeatures = null;
      if (result.error && tracker.isBroken()) void restartTracker();
    }
    updateReadouts(latestFeatures);
  }

  // Framing + overlay redraw run every tick so the virtual camera stays
  // fluid even when the camera frame rate is low.
  const crop = updateFraming(latestFeatures, now);
  clearCanvas(overlayCtx);
  if (latestFeatures && latestResult) {
    drawPreview(
      overlayCtx,
      latestFeatures,
      latestResult.landmarks,
      video.videoWidth,
      video.videoHeight,
      crop,
      true,
    );
  }

  if (state === 'calib' && calibration) {
    if (hasNewFrame) updateCalibration(calibration, now, latestFeatures);
    if (calibration.index !== lastCalibIndex) {
      lastCalibIndex = calibration.index;
      calibPointStart = now;
    }
    if (calibration.phase === 'complete') {
      finishCalibration(calibration);
    } else if (calibration.phase === 'failed') {
      const msg = calibration.error ?? 'not enough samples';
      calibration = null;
      addLog('err', `Calibration failed · ${msg}`);
      setState('live');
    } else {
      renderCalibDot(now);
    }
  } else if (state === 'validate') {
    if (hasNewFrame) runValidateFrame(now, latestFeatures);
    else renderValidateTarget(now);
  } else if (hasNewFrame) {
    showGaze(latestFeatures, now);
  }

  requestAnimationFrame(detectLoop);
};

function startLoop(): void {
  if (loopRunning) return;
  loopRunning = true;
  requestAnimationFrame(detectLoop);
}

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
  autoFramer.reset();
  resizeOverlay();
  setState('live');
  armFrameCallback();
  startLoop(); // framing/preview run even while the tracker loads
  addLog('ok', `Camera ${video.videoWidth || '—'}×${video.videoHeight || '—'} acquired · loading face tracker…`);
  try {
    const next = await createFaceTracker();
    if (state === 'idle') {
      next.close(); // stopped while loading
      return;
    }
    tracker = next;
    addLog('ok', `MediaPipe FaceLandmarker loaded (${next.delegate} inference) · calibrate to begin`);
    if (!gazeModel) restoreCalibration();
  } catch (err) {
    addLog('err', `Face tracker error · ${err instanceof Error ? err.message : 'failed to load'}`);
  }
}

function handleStop(): void {
  if (state === 'idle') return;
  resetValidation();
  if (supportsRVFC && rvfcHandle) video.cancelVideoFrameCallback(rvfcHandle);
  frameReady = false;
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  video.style.transform = '';
  video.style.width = '';
  video.style.height = '';
  videoCssW = 0;
  videoCssH = 0;
  tracker?.close();
  tracker = null;
  gazeModel = null;
  calibration = null;
  gazeFilter.reset();
  lastGazeMs = -Infinity;
  latestFeatures = null;
  latestResult = null;
  autoFramer.reset();
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
  addLog('ok', 'Starting calibration · 9 points, then keep watching the centre dot while moving your head');
  gazeModel = null;
  gazeFilter.reset();
  lastCalibIndex = 0;
  calibPointStart = performance.now();
  calibration = startCalibration(performance.now());
  setState('calib');
  renderCalibDot(performance.now());
}

function handleValidate(): void {
  if (state !== 'live' || !gazeModel) return;
  addLog('ok', `Starting validation · ${VALIDATE_POINTS.length} points`);
  vIndex = 0;
  vPhase = 'dwell';
  vPointStart = performance.now();
  vBuffer = [];
  vResults = [];
  results.hidden = true;
  setState('validate');
  renderValidateTarget(performance.now());
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

function handleFrameToggle(): void {
  if (state === 'idle') return;
  frameOn = !frameOn;
  autoFramer.reset();
  addLog('ok', frameOn ? 'Auto-framing on · keeping eyes centred' : 'Auto-framing off · full frame');
  renderButtons();
}

function toggleDock(): void {
  dockTop = !dockTop;
  applyDock();
}

btnCamera.addEventListener('click', () => {
  if (state === 'idle') void handleStart();
  else handleStop();
});
btnCalibrate.addEventListener('click', handleCalibrate);
btnValidate.addEventListener('click', handleValidate);
btnHeatmap.addEventListener('click', handleHeatmapToggle);
btnFrame.addEventListener('click', handleFrameToggle);
btnDock.addEventListener('click', toggleDock);
resultsDone.addEventListener('click', () => {
  resetValidation();
  if (state === 'validate') setState('live');
});

// ── Keyboard shortcuts ───────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement | null)?.tagName ?? '';
  if (/input|textarea|select/i.test(tag)) return;
  const k = e.key.toLowerCase();
  if (k === 's' && state === 'idle') void handleStart();
  else if (k === 'c' && state === 'live') handleCalibrate();
  else if (k === 'v' && state === 'live') handleValidate();
  else if (k === 'h' && state !== 'idle') handleHeatmapToggle();
  else if (k === 'f' && state !== 'idle') handleFrameToggle();
  else if (e.key === 'Escape' && state !== 'idle') handleStop();
});

// ── Resize ───────────────────────────────────────────────────────────────
function resizeOverlay(): void {
  const r = stage.getBoundingClientRect();
  stageCssW = r.width;
  stageCssH = r.height;
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
  // no longer maps correctly — drop it, then try to restore a calibration
  // saved for this exact viewport size (e.g. rotating back).
  if (gazeModel && state !== 'calib' && state !== 'validate') {
    gazeModel = null;
    gazeFilter.reset();
    hideGazeDot();
    if (!(state === 'live' && restoreCalibration())) {
      addLog('warn', 'Viewport changed · recalibrate to continue');
    }
    renderButtons();
  }
}

window.addEventListener('resize', onViewportChange);
window.addEventListener('orientationchange', onViewportChange);
new ResizeObserver(resizeOverlay).observe(stage);

// ── Init ─────────────────────────────────────────────────────────────────
applyDock();
resizeHeatmap();
resizeOverlay();
setState('idle');
addLog('ok', 'gaze-lite ready · no camera initialised');
