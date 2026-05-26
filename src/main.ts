import './style.css';
import type { AppPhase } from './types';

// Initial scaffold UI: title, description, disabled controls, a status line,
// and empty video/canvas placeholders. No camera or gaze logic yet.

const phase: AppPhase = 'idle';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app root element');
}

app.innerHTML = `
  <main class="page">
    <h1>gaze-lite</h1>
    <p class="lede">
      A browser-only webcam gaze demo. Camera frames are processed locally and
      never leave your device. Tracking is not wired up yet &mdash; this is the
      initial scaffold.
    </p>

    <div class="controls">
      <button id="btn-start" disabled>Start camera</button>
      <button id="btn-calibrate" disabled>Calibrate</button>
      <button id="btn-track" disabled>Show gaze</button>
    </div>

    <p class="status" id="status" role="status">Status: ${phase}</p>

    <div class="stage">
      <video id="video" class="preview" playsinline muted></video>
      <canvas id="overlay" class="overlay" width="640" height="480"></canvas>
    </div>
  </main>
`;
