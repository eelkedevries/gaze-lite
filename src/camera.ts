// Webcam / front-camera access. Frames stay in the browser and are never
// uploaded.

const PREFERRED_VIDEO: MediaTrackConstraints = {
  facingMode: 'user',
  width: { ideal: 1280 },
  height: { ideal: 720 },
};

/**
 * Starts the camera and attaches it to `video`. Prefers the front-facing
 * camera at ~720p; falls back to an unconstrained request if that is rejected.
 * Rejects with a user-facing message when access fails.
 */
export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      'Camera unavailable: open this page over https:// or from localhost to grant camera access.',
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: PREFERRED_VIDEO });
  } catch (preferredError) {
    // Some devices reject the ideal facingMode/resolution; retry with a
    // permissive request before surfacing an error.
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    } catch (fallbackError) {
      throw describeCameraError(fallbackError, preferredError);
    }
  }

  // iOS Safari needs these set before play(); harmless on other browsers.
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    // Autoplay can reject until the element is laid out; the render loop
    // tolerates a video that has not started playing yet.
  }
  return stream;
}

function describeCameraError(error: unknown, fallback?: unknown): Error {
  const name =
    error instanceof DOMException
      ? error.name
      : fallback instanceof DOMException
        ? fallback.name
        : '';

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new Error('Camera permission denied. Allow camera access in your browser and retry.');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return new Error('No camera was found on this device.');
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new Error('The camera is already in use by another app or browser tab.');
    default: {
      const detail = error instanceof Error && error.message ? `: ${error.message}` : '.';
      return new Error(`Could not access the camera${detail}`);
    }
  }
}
