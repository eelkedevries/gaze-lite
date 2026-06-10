// Digital auto-framing ("virtual camera"): computes a crop window over the
// raw video frame that keeps the detected eyes centred in the preview, like a
// software pan-tilt-zoom. The crop follows the eye midpoint with a deadband
// (so micro head movement doesn't make the preview swim) and eases with an
// exponential time-constant; zoom targets a constant on-screen eye span.
// The tracker always sees the full frame — this only changes what is drawn.

import type { FrameCrop, Point } from './types';

// Fraction of the crop width the inter-ocular distance should occupy.
const EYE_SPAN_FRACTION = 0.36;
// Zoom limits, expressed as crop width relative to the full frame width.
const MIN_CROP_FRACTION = 0.28; // never zoom in past ~3.6×
// Re-centre only when the eyes drift this far from the crop centre
// (fraction of crop size); zoom only on a relative size change this large.
const CENTER_DEADBAND = 0.07;
const ZOOM_DEADBAND = 0.12;
// Easing time constants (seconds): follow gently, relax slower. When the
// eyes are far off-centre (a quick head move, or the camera itself moving —
// handheld phones), easing speeds up toward FAST_TAU so they are recentred
// promptly instead of drifting back over half a second.
const FOLLOW_TAU = 0.30;
const FAST_TAU = 0.07;
const RELAX_TAU = 0.8;
// After this long without eyes, ease back out to the full frame.
const LOST_TIMEOUT_MS = 800;

export class AutoFramer {
  private cx = 0;
  private cy = 0;
  private cropW = 0;
  private lastSeenMs = -Infinity;
  private lastUpdateMs: number | null = null;
  private targetCx = 0;
  private targetCy = 0;
  private targetCropW = 0;
  private initialized = false;

  /** Forget all state (e.g. when the camera stops or auto-framing toggles). */
  reset(): void {
    this.initialized = false;
    this.lastUpdateMs = null;
    this.lastSeenMs = -Infinity;
  }

  /**
   * Advances the crop window. `eyeMid` / `interOcular` are in normalized
   * video coordinates (or null while no face is tracked); `aspect` is the
   * preview's width/height. Returns the crop in video pixels.
   */
  update(
    eyeMid: Point | null,
    interOcular: number | null,
    videoW: number,
    videoH: number,
    aspect: number,
    nowMs: number,
  ): FrameCrop {
    const full = coverCrop(videoW, videoH, aspect);
    if (!this.initialized) {
      this.cx = this.targetCx = full.x + full.width / 2;
      this.cy = this.targetCy = full.y + full.height / 2;
      this.cropW = this.targetCropW = full.width;
      this.initialized = true;
    }

    if (eyeMid && interOcular && interOcular > 0) {
      this.lastSeenMs = nowMs;
      const eyeX = eyeMid.x * videoW;
      const eyeY = eyeMid.y * videoH;
      const desiredW = clamp(
        (interOcular * videoW) / EYE_SPAN_FRACTION,
        full.width * MIN_CROP_FRACTION,
        full.width,
      );
      // Deadband: adopt a new target only when the eyes leave the central
      // tolerance zone or the apparent size changes appreciably.
      if (
        Math.abs(eyeX - this.targetCx) > this.targetCropW * CENTER_DEADBAND ||
        Math.abs(eyeY - this.targetCy) > (this.targetCropW / aspect) * CENTER_DEADBAND
      ) {
        this.targetCx = eyeX;
        this.targetCy = eyeY;
      }
      if (
        Math.abs(desiredW - this.targetCropW) >
        this.targetCropW * ZOOM_DEADBAND
      ) {
        this.targetCropW = desiredW;
      }
    } else if (nowMs - this.lastSeenMs > LOST_TIMEOUT_MS) {
      this.targetCx = full.x + full.width / 2;
      this.targetCy = full.y + full.height / 2;
      this.targetCropW = full.width;
    }

    // Exponential easing toward the target (frame-rate independent), sped up
    // in proportion to how far the eyes sit from the crop centre.
    const dt = this.lastUpdateMs === null ? 0 : (nowMs - this.lastUpdateMs) / 1000;
    this.lastUpdateMs = nowMs;
    const tracking = nowMs - this.lastSeenMs <= LOST_TIMEOUT_MS;
    let tau = RELAX_TAU;
    if (tracking) {
      const errFrac =
        Math.hypot(this.targetCx - this.cx, this.targetCy - this.cy) /
        Math.max(this.cropW, 1);
      tau = FAST_TAU + (FOLLOW_TAU - FAST_TAU) / (1 + 14 * errFrac);
    }
    const k = dt > 0 ? 1 - Math.exp(-dt / tau) : 0;
    this.cx += (this.targetCx - this.cx) * k;
    this.cy += (this.targetCy - this.cy) * k;
    this.cropW += (this.targetCropW - this.cropW) * k;

    // Clamp the crop inside the frame (preserving the preview aspect).
    const w = clamp(this.cropW, full.width * MIN_CROP_FRACTION, full.width);
    const h = w / aspect;
    const x = clamp(this.cx - w / 2, 0, videoW - w);
    const y = clamp(this.cy - h / 2, 0, videoH - h);
    return { x, y, width: w, height: h };
  }
}

/** The largest aspect-correct crop of the frame (≡ CSS object-fit: cover). */
export function coverCrop(videoW: number, videoH: number, aspect: number): FrameCrop {
  let w = videoW;
  let h = w / aspect;
  if (h > videoH) {
    h = videoH;
    w = h * aspect;
  }
  return { x: (videoW - w) / 2, y: (videoH - h) / 2, width: w, height: h };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
