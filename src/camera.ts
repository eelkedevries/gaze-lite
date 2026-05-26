// Webcam / front-camera access. Frames must stay in the browser and are never
// uploaded. Implementation lands in a later task; this is a placeholder.

export interface CameraHandle {
  readonly video: HTMLVideoElement;
  stop(): void;
}

export async function startCamera(_video: HTMLVideoElement): Promise<CameraHandle> {
  throw new Error('startCamera is not implemented yet');
}
