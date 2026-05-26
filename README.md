# gaze-lite

A browser-only webcam / smartphone-camera **gaze demo**. It runs entirely as a
static site (GitHub Pages), with no backend and no paid APIs. The goal is a
small app that shows an eye/video preview, draws green boxes around both eyes,
runs a short calibration, and prints a red gaze dot on demand.

> **Status:** camera access, GUI, **MediaPipe face detection**, **both-eye
> tracking boxes**, and a **9-point calibration sweep** are implemented. When
> both eyes are tracked the app draws green boxes around them and reports `Both
> eyes tracked`. `Run calibration` runs the 9-point sweep and stores the
> collected samples in memory. **Gaze estimation is not implemented yet**, so
> `Print gaze` stays disabled until the next step. The green boxes indicate
> landmark-based eye tracking, **not** validated gaze accuracy. A `Stop camera`
> button releases the webcam and clears the preview.

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

> **Note:** calibration only *collects* samples right now. The gaze model and
> the `Print gaze` red dot are implemented in the next step, so `Print gaze`
> stays disabled after calibration completes.

For a good calibration:

- Keep your head reasonably still.
- Use good, even lighting.
- Look directly at each target dot until it moves on.
- Keep your whole face visible to the camera.

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

_TODO_ — to be filled in as features land (browser/device support, accuracy,
lighting sensitivity, calibration drift, etc.).

## Troubleshooting

_TODO_ — to be filled in (camera permissions, secure-context requirements,
blank Pages site / wrong `base`, etc.).
