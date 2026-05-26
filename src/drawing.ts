// Canvas drawing for the camera-preview overlay: green eye-tracking boxes.
// The red gaze dot and calibration targets are drawn in later steps.

import type { EyeBox, EyeFeatures } from './types';

const EYE_BOX_COLOR = '#22c55e';

/** How to map normalized video coordinates onto the overlay canvas. */
export interface PreviewTransform {
  /** Intrinsic video-frame size (video.videoWidth / videoHeight). */
  videoWidth: number;
  videoHeight: number;
  /** Mirror x to match the CSS `scaleX(-1)` selfie preview (see style.css). */
  mirror: boolean;
}

/** Resize a canvas's backing store to a CSS size, scaled for high-DPI screens. */
export function resizeCanvasToDisplaySize(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
): void {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(cssWidth * dpr));
  const h = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

export function clearPreviewOverlay(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

/**
 * Draws green boxes around both eyes. Coordinates in `features` are normalized
 * to the video frame; this maps them through the same `object-fit: cover` crop
 * and horizontal mirror that the CSS applies to the <video>, so the boxes line
 * up with the visible preview.
 */
export function drawEyeBoxes(
  ctx: CanvasRenderingContext2D,
  features: EyeFeatures,
  transform: PreviewTransform,
): void {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const { videoWidth, videoHeight, mirror } = transform;
  if (cw === 0 || ch === 0 || videoWidth === 0 || videoHeight === 0) return;

  // object-fit: cover — scale the frame to fill the box, cropping the overflow.
  const scale = Math.max(cw / videoWidth, ch / videoHeight);
  const dispW = videoWidth * scale;
  const dispH = videoHeight * scale;
  const offX = (cw - dispW) / 2;
  const offY = (ch - dispH) / 2;

  // Mirroring is applied here, and only here, in the drawing layer.
  const mapX = (nx: number): number => {
    const x = offX + nx * dispW;
    return mirror ? cw - x : x;
  };
  const mapY = (ny: number): number => offY + ny * dispH;

  const toRect = (box: EyeBox) => {
    const x1 = mapX(box.x);
    const x2 = mapX(box.x + box.width);
    const y1 = mapY(box.y);
    const y2 = mapY(box.y + box.height);
    return {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
  };

  ctx.save();
  ctx.strokeStyle = EYE_BOX_COLOR;
  ctx.lineWidth = Math.max(2, Math.round(cw * 0.008));
  ctx.lineJoin = 'round';
  for (const box of [features.leftEyeBox, features.rightEyeBox]) {
    const r = toRect(box);
    ctx.strokeRect(r.left, r.top, r.width, r.height);
  }
  ctx.restore();
}
