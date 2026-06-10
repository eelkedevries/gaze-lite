# gaze-lite

A browser-only webcam / smartphone-camera **gaze demo** with a dark
"lab-instrument" UI. It runs entirely as a static site (GitHub Pages), with no
backend and no paid APIs: a single toolbar holds the controls, an in-toolbar
webcam preview **auto-frames your eyes** (a digital pan/zoom keeps them
centred) with cyan eye-tracking boxes, and a red dot follows your estimated
gaze across the screen.

> **Status:** the full flow is implemented — camera start/stop, **MediaPipe
> face tracking** (landmarks + blendshapes + a metric **head pose**) with cyan
> eye boxes and head-axis gizmo, **L/R quality + head + FPS readouts**, a
> session **log**, a full-screen **9-point calibration plus a head-movement
> sweep**, a **head-pose-compensated gaze model** driving a red dot smoothed by
> a **One Euro filter**, an optional **heatmap**, a **validation** pass, and
> **calibration persistence** across reloads. Calibration is invalidated on a
> viewport resize / orientation change (it restores automatically when the
> size matches a saved one). Estimates are **approximate** — this is a demo,
> not a validated/scientific eye tracker.

## Live demo

**https://eelkedevries.github.io/gaze-lite/**

(Served over HTTPS, which is required for camera access.)

## Interface

A single **toolbar** floats at the bottom of the screen (a **dock toggle** at
its right end moves it to the top and back):

- **Row 1 — actions:** **Camera** (toggles to **Stop** while live), **Calibrate**,
  **Validate**, **Heatmap**, **Frame** (toggle the eye-centering auto-framing),
  and the dock toggle. Calibrate is enabled only when live; **Validate** also
  needs a completed calibration. Keyboard: `S` start, `C` calibrate,
  `V` validate, `H` heatmap, `F` auto-frame, `Esc` stop.
- **Row 2 — webcam preview** (mirrored, **auto-framed on the eyes**: a smoothed
  digital pan/zoom keeps the detected eyes centred — like a software
  pan-tilt-zoom camera) with cyan **eye-tracking boxes** (colored by per-eye
  quality), iris dots, a face reticle, a **head-pose axis gizmo**, and a
  downsampled landmark mesh; plus **L / R** eye-quality readouts (0–100,
  color-coded), a **Head** yaw/pitch readout in degrees, and **FPS**.
- **Row 3 — log strip:** the latest timestamped entry; click to expand the full
  session log (it opens away from the screen edge the toolbar is docked to, and
  has a **Clear** button).

Other surfaces: a red **gaze dot** that follows your gaze after calibration, an
optional full-screen **heatmap**, a full-screen **calibration** mode (everything
hides except a shrinking red target), and a **validation** pass that walks a set
of fixation points and ends on a **results screen** listing the measured
deviation (Δpx) at each point and the average.

## Features

- **Start / Stop camera** with the front-facing camera preferred on mobile.
- Live **face tracking** (478 landmarks incl. iris, 52 blendshapes, and a
  metric **head pose** from the facial transformation matrix) with
  quality-colored eye boxes in the preview. GPU inference where available,
  with automatic CPU fallback.
- **Auto-framing**: the preview digitally pans/zooms to keep the detected
  eyes centred (deadband + eased follow, like a virtual camera operator).
- Full-screen **9-point calibration + head-movement sweep** and an in-browser
  **cross-validated ridge-regression** gaze model that **compensates for head
  movement** (rotation, translation, and distance).
- A red gaze dot smoothed by a **One Euro filter** (steady fixations, snappy
  saccades), **blink-gated** so it holds rather than jumps when you blink; an
  optional **heatmap**; and a **validation** pass with a measured-deviation
  results screen.
- **Calibration persists** locally (per viewport size) and restores on reload.
- Timestamped **session log** and live **L/R/Head/FPS** readouts.
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

Face tracking uses MediaPipe's **Face Landmarker**, and it runs **entirely in
the browser** (WebAssembly, with GPU inference where available and automatic
CPU fallback) — no frames are sent anywhere. The bundled `.task` model includes
the landmark, **blendshape**, and **face-geometry** submodels, so the iris
landmarks, eyeLook/eyeBlink coefficients, and the head-pose transformation
matrix all come from the same file. Two local assets are served by the app, so
there is no runtime CDN dependency:

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

Clicking **Calibrate** clears the screen to black and runs two stages:

1. **Nine fixation points** (corners, edge midpoints, and centre). Each target
   is a solid red dot that shrinks while it samples; every valid frame —
   tracked face, **no blink** (gated by the eyeBlink blendshapes and an
   eye-aspect-ratio check) — contributes one sample, and outlier frames
   (micro-saccades, distractions) are pruned per point with a z-score test.
   On slow devices the sampling window extends automatically instead of
   failing. A point with too few good samples is retried once; if it still
   fails, the run stops with a clear status.
2. **A head-movement sweep**: the dot returns to the centre and asks you to
   *keep looking at it while slowly turning and moving your head* for a few
   seconds. These frames have a known gaze target but varying head pose —
   exactly the data the model needs to **learn how to cancel head movement
   out of the gaze estimate**.

**Stop** cancels an in-progress calibration. When the sweep finishes, the app
fits the gaze model from all per-frame samples (typically a few hundred),
logs its cross-validated error estimate, saves the calibration locally, and
returns to the live screen, where the red gaze dot begins following your gaze.
If the model cannot be fitted, a clear error is logged instead.

For a good calibration:

- Use good, even lighting and keep your whole face visible to the camera.
- Look directly at each target dot until it moves on.
- Keep your head still during the nine points; move it **only** during the
  centre-dot sweep stage (gently — turn, tilt, shift, lean in/out).

## Gaze estimation

MediaPipe only provides face/eye **landmarks**, **blendshapes**, and a head
**transformation matrix**; it does not tell you where on the screen you are
looking. gaze-lite estimates that with a small **custom calibration model**
built from your calibration samples (see `src/eyeFeatures.ts` and
`src/gazeModel.ts`):

- **Per-eye gaze offsets** — where the iris centre sits relative to the eye
  corners, measured in each eye's own corner-aligned 2-D frame and divided by
  the eye width. Anchoring to the corners makes the signal invariant to head
  roll and scale by construction, and first-order-invariant to yaw
  foreshortening, without relying on the (noisy) landmark depth.
- **Blendshape gaze** — the eight `eyeLook*` coefficients, a learned,
  largely pose-independent second opinion on eyeball rotation.
- **Head pose** — yaw/pitch/roll and metric translation decomposed from the
  facial transformation matrix (the head's position in centimetres relative
  to the camera), plus distance-scaled lateral offsets. These let the model
  **subtract head movement from the gaze estimate**; the calibration's head
  sweep supplies the data that gives these features their weights.
- **Quadratic + interaction terms** — the standard second-order screen-mapping
  expansion of the combined gaze signal, plus gaze × distance and gaze × turn
  interactions (a fixed eye rotation spans more screen the farther you sit).
- The model is two **ridge regressions** (feature vector → screen x, and →
  screen y) over standardized features (floored divisor, unpenalized
  intercept), trained on **every valid calibration frame** and regularized
  with a strength chosen by **leave-one-point-out cross-validation**; the log
  reports the resulting error estimate.
- After calibration the gaze dot tracks **continuously**: each camera frame's
  features are fed through the model and the dot is redrawn at the predicted
  point, smoothed by a **One Euro filter** (adaptive low-pass: steady while
  you fixate, fast during saccades), held during **blinks**, and clamped to
  the viewport. Enable **Heatmap** to accumulate a warm density map of where
  you've looked, or run **Validate**, which shows five fixation points,
  samples the predicted gaze at each, and reports the measured deviation
  (Δpx) per point plus an average on a results screen.

Because the model maps to **screen coordinates**, it is tied to the current
window/screen size; a resize or orientation change invalidates it. Completed
calibrations are saved in `localStorage` (per viewport size, locally on your
device) and restore automatically when the size matches — e.g. after a reload
or when rotating back.

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

- **Approximate accuracy.** Gaze is estimated from a webcam-grade iris signal
  and a calibrated regression; expect rough, not pixel-accurate, results.
- **Partially compensated head movement.** The model corrects for moderate
  head rotation/translation around your calibrated position (do the head-sweep
  stage!), but large pose changes — leaning far in, extreme turns, standing
  up — still degrade accuracy. Recalibrate if you move a lot.
- **Sensitive to lighting and camera angle.** Poor or uneven lighting and
  off-axis cameras reduce landmark quality and accuracy.
- **Glasses / reflections** can reduce robustness of eye and iris tracking.
- **Device/window dependent.** Calibration maps to the current screen, so
  resizing the window or changing orientation invalidates it (it restores
  automatically if a calibration for that size was saved) — recalibrate when
  prompted.

## Troubleshooting

- **Clicking *Camera* does nothing / no permission prompt.** The page must be a
  *secure context*. Use `http://localhost` in dev or the HTTPS live demo — a
  plain-HTTP LAN IP (e.g. `http://192.168.x.x`) blocks the camera.
- **The font looks like a system font.** JetBrains Mono is loaded from Google
  Fonts; if that request is blocked the UI falls back to a monospace system
  font (purely cosmetic).
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
  window or rotating the device invalidates calibration; if no saved
  calibration matches the new size, run calibration again.
- **The dot drifts after you moved.** Head compensation is strongest near the
  poses you showed it during the head sweep — recalibrate (and actually move
  your head during the sweep stage) if you've changed position a lot.

## Development roadmap

Done: scaffold + Pages deploy, camera + GUI, MediaPipe face tracking (incl.
blendshapes + head pose), eye boxes + head gizmo, auto-framed preview,
9-point + head-sweep calibration, a head-pose-compensated cross-validated
ridge model with quadratic features, One Euro smoothing with blink gating,
validation, and `localStorage` calibration persistence.

Possible next steps (not implemented):

- Scaling predictions on resize instead of invalidating calibration.
- Smooth-pursuit (moving-target) calibration for denser screen coverage.
- Fixation detection (I-DT) for dwell interactions / a steadier idle dot.
- An automated test suite (there is none yet).
