// Saves/restores calibration samples in localStorage so a reload (or a resize
// back to a previous window size) doesn't force a full recalibration. Samples
// are slotted by viewport size and guarded by the feature-layout version: the
// gaze model maps features to a specific screen geometry, so any mismatch
// means "don't restore". A few recent sizes are kept so rotating a phone
// portrait → landscape → portrait restores both ways. Storage is per-origin
// and local — nothing leaves the device.

import type { CalibrationSample } from './types';

const STORAGE_KEY = 'gaze-lite/calibration';
const MAX_SLOTS = 4;

interface CalibrationSlot {
  savedAt: number;
  samples: CalibrationSample[];
}

interface StoredCalibrations {
  featureVersion: number;
  /** Keyed by `${viewportW}x${viewportH}`. */
  slots: Record<string, CalibrationSlot>;
}

function viewportKey(): string {
  return `${window.innerWidth}x${window.innerHeight}`;
}

function readStore(featureVersion: number): StoredCalibrations {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredCalibrations;
      if (parsed.featureVersion === featureVersion && parsed.slots) return parsed;
    }
  } catch {
    // Corrupt/foreign payload — start fresh.
  }
  return { featureVersion, slots: {} };
}

export function saveCalibration(
  featureVersion: number,
  samples: CalibrationSample[],
): void {
  const store = readStore(featureVersion);
  store.slots[viewportKey()] = { savedAt: Date.now(), samples };
  // Keep only the most recent slots.
  const keys = Object.keys(store.slots).sort(
    (a, b) => store.slots[b].savedAt - store.slots[a].savedAt,
  );
  for (const k of keys.slice(MAX_SLOTS)) delete store.slots[k];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Private mode / quota — persistence is best-effort.
  }
}

/**
 * Returns the stored slot matching the current viewport and feature layout,
 * else null.
 */
export function loadCalibration(featureVersion: number): CalibrationSlot | null {
  const slot = readStore(featureVersion).slots[viewportKey()];
  if (!slot || !Array.isArray(slot.samples) || slot.samples.length === 0) return null;
  return slot;
}

export function clearCalibration(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
