// Canvas drawing for the redesigned UI:
//   - the small in-toolbar camera preview overlay (cyan eye boxes with corner
//     ticks, iris dots, face reticle, optional landmark mesh)
//   - the full-viewport gaze heatmap
// The live gaze dot and calibration target are plain DOM elements (see main.ts),
// not canvas-drawn.

import type { EyeBox, EyeFeatures, NormalisedPoint } from './types';

// Design tokens (mirrors of the CSS custom properties) for canvas use.
const TRACK = 'oklch(0.82 0.13 200)';
const WARN = 'oklch(0.82 0.16 90)';
const GAZE = 'oklch(0.66 0.21 25)';
const MESH = 'oklch(0.92 0.04 200 / 0.55)';
const RETICLE = 'oklch(1 0 0 / 0.06)';

/** Resize a canvas's backing store to a CSS size, scaled for high-DPI screens. */
export function resizeCanvasToDisplaySize(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  maxDpr = Infinity,
): void {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const w = Math.max(1, Math.round(cssWidth * dpr));
  const h = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

export function clearCanvas(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function qualityColor(q: number): string {
  return q > 0.6 ? TRACK : q > 0.3 ? WARN : GAZE;
}

/**
 * Draws the preview overlay in the toolbar. Coordinates in `features` /
 * `landmarks` are normalized to the video frame and mapped through the same
 * `object-fit: cover` crop the <video> uses. The preview's CSS stage applies
 * the horizontal mirror, so nothing is mirrored here.
 */
export function drawPreview(
  ctx: CanvasRenderingContext2D,
  features: EyeFeatures,
  landmarks: NormalisedPoint[],
  videoWidth: number,
  videoHeight: number,
  showMesh: boolean,
): void {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  if (cw === 0 || ch === 0 || videoWidth === 0 || videoHeight === 0) return;
  const dpr = window.devicePixelRatio || 1;

  // object-fit: cover mapping.
  const scale = Math.max(cw / videoWidth, ch / videoHeight);
  const dispW = videoWidth * scale;
  const dispH = videoHeight * scale;
  const offX = (cw - dispW) / 2;
  const offY = (ch - dispH) / 2;
  const mapX = (nx: number): number => offX + nx * dispW;
  const mapY = (ny: number): number => offY + ny * dispH;

  // Face reticle through the centroid.
  ctx.save();
  ctx.strokeStyle = RETICLE;
  ctx.lineWidth = Math.max(1, 0.5 * dpr);
  const fcx = mapX(features.faceCenter.x);
  const fcy = mapY(features.faceCenter.y);
  ctx.beginPath();
  ctx.moveTo(fcx, 0);
  ctx.lineTo(fcx, ch);
  ctx.moveTo(0, fcy);
  ctx.lineTo(cw, fcy);
  ctx.stroke();

  // Landmark mesh (downsampled — the full mesh is far too dense at this size).
  if (showMesh) {
    ctx.fillStyle = MESH;
    const r = Math.max(0.6, 0.7 * dpr);
    for (let i = 0; i < landmarks.length; i += 5) {
      const p = landmarks[i];
      ctx.beginPath();
      ctx.arc(mapX(p.x), mapY(p.y), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawEyeBox(ctx, features.leftEyeBox, qualityColor(features.leftQuality), mapX, mapY, dpr);
  drawEyeBox(ctx, features.rightEyeBox, qualityColor(features.rightQuality), mapX, mapY, dpr);

  // Iris dots.
  const irisR = Math.max(1.2, 1.6 * dpr);
  for (const c of [features.leftIrisLikeCenter, features.rightIrisLikeCenter]) {
    if (!c) continue;
    ctx.fillStyle = TRACK;
    ctx.beginPath();
    ctx.arc(mapX(c.x), mapY(c.y), irisR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawEyeBox(
  ctx: CanvasRenderingContext2D,
  box: EyeBox,
  color: string,
  mapX: (n: number) => number,
  mapY: (n: number) => number,
  dpr: number,
): void {
  const x1 = mapX(box.x);
  const x2 = mapX(box.x + box.width);
  const y1 = mapY(box.y);
  const y2 = mapY(box.y + box.height);
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, 1 * dpr);
  ctx.strokeRect(left, top, w, h);

  // Corner ticks.
  const t = Math.max(2.5, 3.5 * dpr);
  ctx.lineWidth = Math.max(1, 1.4 * dpr);
  for (const [cx, cy] of [
    [left, top],
    [left + w, top],
    [left, top + h],
    [left + w, top + h],
  ]) {
    ctx.beginPath();
    ctx.moveTo(cx - t, cy);
    ctx.lineTo(cx + t, cy);
    ctx.moveTo(cx, cy - t);
    ctx.lineTo(cx, cy + t);
    ctx.stroke();
  }
}

/** Draws the gaze heatmap. Samples are in CSS viewport pixels. */
export function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  samples: ReadonlyArray<{ x: number; y: number }>,
  maxDpr = 2,
): void {
  const c = ctx.canvas;
  ctx.clearRect(0, 0, c.width, c.height);
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const r = 80 * dpr;
  for (const s of samples) {
    const x = s.x * dpr;
    const y = s.y * dpr;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255, 64, 64, 0.42)');
    g.addColorStop(0.45, 'rgba(255, 140, 40, 0.18)');
    g.addColorStop(1, 'rgba(255, 200, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
