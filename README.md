# gaze-lite

A browser-only webcam / smartphone-camera **gaze demo**. It runs entirely as a
static site (GitHub Pages), with no backend and no paid APIs. The goal is a
small app that shows an eye/video preview, draws green boxes around both eyes,
runs a short calibration, and prints a red gaze dot on demand.

> **Status:** the full v1 flow is implemented — camera start/stop, **MediaPipe
> face detection**, **both-eye tracking boxes**, a **9-point calibration
> sweep**, a **calibrated gaze model**, and **`Print gaze`**, which toggles a
> red dot that **continuously follows** your estimated gaze. Calibration is
> invalidated on a viewport resize / orientation change (recalibrate when
> prompted). Estimates are **approximate** — this is a demo, not a
> validated/scientific eye tracker.

## Live demo

**https://eelkedevries.github.io/gaze-lite/**

(Served over HTTPS, which is required for camera access.)

## Features

- **Start / Stop camera** with the front-facing camera preferred on mobile.
- Live **face detection** and **green boxes around both eyes** while tracked.
- **9-point calibration** sweep with on-screen targets and progress.
- A small **calibrated gaze model** (ridge regression) fitted in the browser.
- **Print gaze** — a red dot that **continuously follows** your estimated gaze,
  plus **Clear dot**.
- Clear status messages for every state and failure mode.
- 100% client-side: **no backend, no uploads, no analytics**.

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

## Browser & device support

Targets modern evergreen browsers on **Android, Windows, and Linux** (Chrome,
Edge, Firefox; WebKit/Safari should work but is less tested). It needs
`getUserMedia`, WebAssembly, and `ResizeObserver` — all standard in current
browsers.

**Testing on Android:** open the **live demo** (HTTPS) on the phone — that is
the simplest path, since the camera needs a secure context. Then Start camera,
allow permission (front camera is requested), and run a calibration. The UI is
touch-friendly and the canvases re-fit on orientation change (note: rotating
the device counts as a viewport change and invalidates calibration, so
recalibrate afterwards).

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

- From each frame's landmarks it derives a small feature vector: **where the
  iris sits inside each eye box** (left and right) — the values that actually
  move with gaze. Absolute eye/face positions, eye-box sizes and head scale are
  intentionally excluded because they barely change during a head-still
  calibration and would destabilize the linear fit (see `src/eyeFeatures.ts`).
- It fits two small **ridge regressions** (feature vector → screen x, and →
  screen y) with standardized features (with a floored divisor) and an
  unpenalized intercept. The ridge penalty plus the std floor keep coefficients
  bounded so predictions don't extrapolate off-screen (`src/gazeModel.ts`).
- **Print gaze** toggles **continuous** gaze tracking: while on, every frame the
  latest feature vector is fed through the model and the red dot is redrawn at
  the predicted point (exponentially smoothed and clamped to the viewport), so
  the dot follows your gaze in real time. Click it again to stop (the last dot
  stays put); **Clear dot** removes it. If both eyes drop out, the dot holds its
  last position.

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

- **Clicking *Start camera* does nothing / no permission prompt.** The page
  must be a *secure context*. Use `http://localhost` in dev or the HTTPS live
  demo — a plain-HTTP LAN IP (e.g. `http://192.168.x.x`) blocks the camera.
- **"Camera permission denied".** Allow camera access for the site in the
  browser's address-bar / site settings, then reload and retry.
- **"The camera is already in use".** Another tab or app holds the camera.
  Close it and retry.
- **"Face tracker error: could not load the face model or runtime".** The
  MediaPipe model/WASM assets did not load — check your connection and that
  `public/models/face_landmarker.task` and `public/mediapipe/wasm/` are
  deployed (the WASM is copied by `scripts/copy-wasm.mjs` on `dev`/`build`).
- **Blank page on GitHub Pages, or 404s for `/assets/...`.** Pages must serve
  the **built** site: set **Settings → Pages → Source → GitHub Actions** (not
  "Deploy from a branch"). Also ensure Vite's `base` (`/gaze-lite/`) matches the
  repository name. *View Source* should reference `…/gaze-lite/assets/…js`, not
  `/src/main.ts`.
- **Calibration keeps failing at a point.** Improve lighting, hold your head
  still, and keep both eyes clearly visible; very dark scenes or strong glasses
  reflections can prevent stable tracking.
- **The dot suddenly stops following / "Viewport changed".** Resizing the
  window or rotating the device invalidates calibration — run calibration
  again.

## Development roadmap

Done: scaffold + Pages deploy, camera + GUI, MediaPipe face detection, eye
boxes, 9-point calibration, gaze model, and continuous `Print gaze` with
exponential smoothing.

Possible next steps (not implemented):

- Scaling predictions on resize instead of invalidating calibration.
- Persisting calibration (e.g. `localStorage`) across reloads.
- A richer/non-linear model and an on-screen accuracy check.
- An automated test suite (there is none yet).
