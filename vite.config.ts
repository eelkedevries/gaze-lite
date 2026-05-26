import { defineConfig } from 'vite';

// `base` must match the GitHub Pages project path so built asset URLs resolve
// correctly when served from https://<user>.github.io/gaze-lite/.
export default defineConfig({
  base: '/gaze-lite/',
});
