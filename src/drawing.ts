// Canvas drawing helpers: green eye boxes and the red gaze dot.
// Placeholder for the initial scaffold.

import type { EyeBoxes, Point2D } from './types';

export function clear(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

export function drawEyeBoxes(_ctx: CanvasRenderingContext2D, _boxes: EyeBoxes): void {
  throw new Error('drawEyeBoxes is not implemented yet');
}

export function drawGazeDot(_ctx: CanvasRenderingContext2D, _point: Point2D): void {
  throw new Error('drawGazeDot is not implemented yet');
}
