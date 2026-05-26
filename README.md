# gaze-lite

A browser-only webcam / smartphone-camera **gaze demo**. It runs entirely as a
static site (GitHub Pages), with no backend and no paid APIs. The goal is a
small app that shows an eye/video preview, draws green boxes around both eyes,
runs a short calibration, and prints a red gaze dot on demand.

> **Status:** the full v1 flow is implemented — camera start/stop, **MediaPipe
> face detection**, **both-eye tracking boxes**, a **9-point calibration
> sweep**, a **calibrated gaze model**, and **`Print gaze`**, which draws a red
> dot at the estimated gaze location. Calibration is invalidated on a viewport
> resize / orientation change (recalibrate when prompted). Estimates are
> **approximate** — this is a demo, not a validated/scientific eye tracker.

## Stack

- [Vite](https://vitejs.dev/) + TypeScript
- Plain HTML / CSS / Canvas (no framework)
- Face landmark detection via [`@mediapipe/tasks-vision`](https://www.npmjs.com/package/@mediapipe/tasks-vision) (MediaPipe Face Landmarker)

## Local development

Requires Node.js 20+.

```bash
npm install      # install dependencies
npm run dev      # start the dev server (http://localhost:5173/gaze-lite/)
npm run build    # type-check + production build into dist/
npm run preview  # preview the production build locally
```

The dev and preview servers bind to `0.0.0.0`, so you can also open the app
from a phone on the same network using your machine's LAN IP.

## Camera & permissions

- The browser will prompt for camera permission the first time you click
  **Start camera**. You must allow it for the preview to appear.
- **Test camera access via `localhost`.** `getUserMedia` only works in a
  *secure context* — `https://` or `http://localhost`.
- **LAN IP testing (e.g. a phone hitting `http://192.168.x.x:5173`) will
  usually block the camera**, because a plain-HTTP LAN origin is not a secure
  context. Use an HTTPS tunnel (or the deployed HTTPS Pages site) to test on a
  phone.
- On Android, the app requests the **front-facing camera** (`facingMode:
  'user'`) and falls back to whatever camera is available if that request is
  rejected.
- Clear, user-facing messages are shown for the common failures: permission
  denied, no camera found, camera already in use, and insecure context.

## Face tracking & model assets

Face detection uses MediaPipe's **Face Landmarker**, and it runs **entirely in
the browser** (WebAssembly) — no frames are sent anywhere. Two local assets are
served by the app, so there is no runtime CDN dependency:

- **Model:** `public/models/face_landmarker.task` (committed). To refresh or
  re-obtain it, download the float16 model:
  ```bash
  curl -L -o public/models/face_landmarker.task \
    https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
  ```
- **WASM runtime:** copied out of `node_modules/@mediapipe/tasks-vision/wasm`
  into `public/mediapipe/wasm/` by `scripts/copy-wasm.mjs`. This runs
  automatically via the `predev` / `prebuild` npm hooks, so `npm run dev` and
  `npm run build` set it up for you. The copied folder is git-ignored.

If the model or WASM cannot be loaded, the app surfaces a clear
`Face tracker error: …` message rather than failing silently.

## Calibration

Clicking **Run calibration** runs a **9-point sweep** (corners, edge midpoints,
and centre). For each target the app shows a high-contrast dot, waits briefly
for your gaze to settle, then averages the eye-feature vectors collected over a
short window — accepting only frames where **both eyes are tracked**. The nine
averaged samples (each paired with its on-screen target) are stored in memory.
A point with too few good samples is retried once; if it still fails, the run
stops with a clear status. **Stop camera** (or starting a new run) cancels an
in-progress calibration.

When the sweep finishes, the app fits the gaze model from the nine samples,
enables **Print gaze**, and reports `Calibrated — ready to print gaze`. If the
model cannot be fitted, `Print gaze` stays disabled and a clear error is shown.

For a good calibration:

- Keep your head reasonably still.
- Use good, even lighting.
- Look directly at each target dot until it moves on.
- Keep your whole face visible to the camera.

## Gaze estimation

MediaPipe only provides face/eye **landmarks**; it does not tell you where on
the screen you are looking. gaze-lite estimates that with a small **custom
calibration model** built from your nine calibration samples:

- From each frame's landmarks it derives a numeric eye-feature vector (eye-box
  sizes, eye and iris-like centres, head scale, and where the iris sits inside
  each eye box — see `src/eyeFeatures.ts`).
- It fits two small **ridge regressions** (feature vector → screen x, and →
  screen y) with standardized features and an unpenalized intercept. Ridge
  regularization keeps the fit stable given only nine points
  (`src/gazeModel.ts`).
- **Print gaze** feeds the latest eye-feature vector through the model and draws
  a red dot at the predicted point (clamped to the viewport). If both eyes are
  not currently tracked it reports that instead of drawing a stale dot.

Because the model maps to **screen coordinates**, it is tied to the current
window/screen size; a resize or orientation change invalidates it and you must
recalibrate.

## GitHub Pages deployment

Deployment is automated by `.github/workflows/deploy.yml`:

1. Push to `main` (or run the workflow manually via **Actions → Run workflow**).
2. The workflow runs `npm ci`, `npm run build`, and publishes `./dist` to Pages.

The Vite `base` is set to `'/gaze-lite/'` so asset URLs resolve correctly at
`https://<user>.github.io/gaze-lite/`. If you fork/rename the repo, update
`base` in `vite.config.ts` to match the new project path.

One-time setup: in the repository settings, set **Settings → Pages → Build and
deployment → Source** to **GitHub Actions**.

## Privacy

Camera frames are processed **locally in your browser** and are **never
uploaded**. There is no backend, no analytics, and no external logging. Nothing
about your video or gaze leaves your device.

## Known limitations

This is a lightweight demo, **not** a scientific or commercial-grade eye
tracker, and is not equivalent to dedicated eye-tracking hardware. In
particular:

- **Approximate accuracy.** Gaze is estimated from a 9-point calibration and a
  simple linear model; expect rough, not pixel-accurate, results.
- **Sensitive to head movement.** Moving or rotating your head after
  calibrating degrades accuracy — keep your head roughly where it was.
- **Sensitive to lighting and camera angle.** Poor or uneven lighting and
  off-axis cameras reduce landmark quality and accuracy.
- **Glasses / reflections** can reduce robustness of eye and iris tracking.
- **Device/window dependent.** Calibration maps to the current screen, so
  resizing the window or changing orientation invalidates it — recalibrate when
  prompted.

## Troubleshooting

_TODO_ — to be filled in (camera permissions, secure-context requirements,
blank Pages site / wrong `base`, etc.).
