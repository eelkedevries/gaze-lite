# AGENTS.md

Repository instructions for AI agents and contributors working on **gaze-lite**.

## What this is

A browser-only webcam/smartphone gaze demo. It runs as a static site on GitHub
Pages with **no backend, no server runtime, and no paid APIs**. All camera
frames are processed locally in the browser and are never uploaded.

## Stack

- Vite + TypeScript
- Plain HTML / CSS / Canvas (no framework, no React for v1)
- Face landmark detection via `@mediapipe/tasks-vision` (runs locally in WASM)

## Commands

- `npm install` — install dependencies
- `npm run dev` — local dev server (`vite --host 0.0.0.0`)
- `npm run build` — type-check then build (`tsc && vite build`)
- `npm run preview` — preview the production build

## Hard constraints — do not violate

- No backend, no server runtime, no database.
- No paid APIs, no analytics, no external logging.
- No video upload; frames stay on-device.
- No React in v1.
- Do not use WebGazer.js.
- Keep it deployable as a static site on GitHub Pages.

## Deployment

- GitHub Pages via `.github/workflows/deploy.yml` (builds `./dist`).
- Vite `base` is `'/gaze-lite/'` and must match the Pages project path.

## Source layout (`src/`)

- `main.ts` — app entry, UI wiring, detection/render loop
- `camera.ts` — webcam / front-camera access
- `faceLandmarks.ts` — MediaPipe FaceLandmarker wrapper (landmarks,
  blendshapes, head matrix; GPU→CPU delegate fallback)
- `headPose.ts` — transformation matrix → yaw/pitch/roll + translation
- `eyeFeatures.ts` — eye boxes + gaze feature vector (layout documented there)
- `calibration.ts` — 9-point + head-sweep sample collection
- `gazeModel.ts` — features → on-screen gaze point (ridge + CV)
- `filters.ts` — One Euro filter (gaze dot smoothing)
- `autoFrame.ts` — eye-centering digital pan/zoom for the preview
- `persistence.ts` — localStorage save/restore of calibration samples
- `drawing.ts` — canvas drawing (preview overlay, heatmap)
- `types.ts` — shared types

## Conventions

- TypeScript is required; use interfaces where they add clarity; keep minimal.
- Comments only when they explain non-obvious *why*, not *what*.
- Prefix intentionally-unused parameters with `_` (strict tsconfig).
- **`npm run build` must pass** (it runs `tsc` then `vite build`) before any
  commit/push. There is no separate test/lint script yet — don't invent one.

## Final response format

When completing a task, end the response with exactly these sections:

- `## Work done` — what was implemented and whether it succeeded.
- `## Checks run` — each check/command run and whether it passed.
- `## Open issues` — unresolved issues, missing tests, or assumptions.
- `## Human actions required` — what the user must do next.
