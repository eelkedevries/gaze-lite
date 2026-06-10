// One Euro filter (Casiez, Roussel & Vogel, CHI 2012) — an adaptive low-pass
// filter for noisy interactive signals. At low speeds it smooths hard (kills
// jitter while fixating); at high speeds it opens up (low lag during
// saccades). This replaces a fixed EMA, which must trade those two off.
// Reference: https://gery.casiez.net/1euro/

export interface OneEuroOptions {
  /** Baseline cutoff (Hz) at zero speed — lower = steadier fixations. */
  minCutoff: number;
  /** How fast the cutoff grows with speed — higher = snappier saccades. */
  beta: number;
  /** Cutoff (Hz) for the internal derivative low-pass. */
  dCutoff: number;
}

function smoothingAlpha(cutoffHz: number, dtSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSeconds);
}

class LowPass {
  private initialized = false;
  private value = 0;

  filter(x: number, alpha: number): number {
    if (!this.initialized) {
      this.initialized = true;
      this.value = x;
    } else {
      this.value = alpha * x + (1 - alpha) * this.value;
    }
    return this.value;
  }

  reset(): void {
    this.initialized = false;
  }
}

export class OneEuroFilter {
  private readonly options: OneEuroOptions;
  private readonly xFilter = new LowPass();
  private readonly dxFilter = new LowPass();
  private lastTimeMs: number | null = null;
  private lastRaw: number | null = null;

  constructor(options: OneEuroOptions) {
    this.options = options;
  }

  filter(x: number, timeMs: number): number {
    const { minCutoff, beta, dCutoff } = this.options;
    let dt = this.lastTimeMs === null ? 0 : (timeMs - this.lastTimeMs) / 1000;
    if (!(dt > 1e-6)) dt = 1 / 30; // first sample / clock hiccup: assume 30 Hz
    const dx = this.lastRaw === null ? 0 : (x - this.lastRaw) / dt;
    this.lastTimeMs = timeMs;
    this.lastRaw = x;

    const dxHat = this.dxFilter.filter(dx, smoothingAlpha(dCutoff, dt));
    const cutoff = minCutoff + beta * Math.abs(dxHat);
    return this.xFilter.filter(x, smoothingAlpha(cutoff, dt));
  }

  reset(): void {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTimeMs = null;
    this.lastRaw = null;
  }
}

/** A One Euro filter over a 2-D point (shared clock, per-axis state). */
export class OneEuroFilter2D {
  private readonly fx: OneEuroFilter;
  private readonly fy: OneEuroFilter;

  constructor(options: OneEuroOptions) {
    this.fx = new OneEuroFilter(options);
    this.fy = new OneEuroFilter(options);
  }

  filter(x: number, y: number, timeMs: number): { x: number; y: number } {
    return { x: this.fx.filter(x, timeMs), y: this.fy.filter(y, timeMs) };
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
  }
}
