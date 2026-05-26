# gaze-lite

A browser-only webcam / smartphone-camera **gaze demo**. It runs entirely as a
static site (GitHub Pages), with no backend and no paid APIs. The goal is a
small app that shows an eye/video preview, draws green boxes around both eyes,
runs a short calibration, and prints a red gaze dot on demand.

> **Status:** initial scaffold only. Camera access, MediaPipe landmark
> detection, calibration, and gaze estimation are **not implemented yet**.

## Stack

- [Vite](https://vitejs.dev/) + TypeScript
- Plain HTML / CSS / Canvas (no framework)
- Landmark detection (planned) via [`@mediapipe/tasks-vision`](https://www.npmjs.com/package/@mediapipe/tasks-vision)

## Local development

Requires Node.js 20+.

```bash
npm install      # install dependencies
npm run dev      # start the dev server (http://localhost:5173/gaze-lite/)
npm run build    # type-check + production build into dist/
npm run preview  # preview the production build locally
```

The dev and preview servers bind to `0.0.0.0`, so you can also open the app
from a phone on the same network using your machine's LAN IP. A secure context
(`https://` or `localhost`) is required for camera access once it is added.

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
