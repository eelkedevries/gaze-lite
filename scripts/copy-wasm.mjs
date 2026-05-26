// Copies the MediaPipe tasks-vision WASM runtime out of node_modules into
// public/ so the app can self-host it (no runtime CDN). Runs via the predev /
// prebuild npm hooks; the destination is gitignored and regenerated on demand.
import { createRequire } from 'node:module';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
// The package's `exports` map hides package.json, so resolve the main bundle
// (which sits at the package root) and take its sibling `wasm` directory.
const wasmSrc = join(dirname(require.resolve('@mediapipe/tasks-vision')), 'wasm');
const dest = join(process.cwd(), 'public', 'mediapipe', 'wasm');

mkdirSync(dest, { recursive: true });
cpSync(wasmSrc, dest, { recursive: true });
console.log(`Copied MediaPipe WASM runtime -> ${dest}`);
