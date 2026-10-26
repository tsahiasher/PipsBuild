import type { RecognitionResult } from './recognize';
import type { WorkerResponse } from './worker';

/** Longest side analysed; larger screenshots are downscaled (recognition is resolution independent). */
const MAX_SIDE = 2400;

export interface LoadedImage {
  imageData: ImageData;
  /** JPEG data URL of the (possibly downscaled) image, for the overlay view. */
  dataUrl: string;
}

export async function loadImageFile(file: Blob): Promise<LoadedImage> {
  const bitmap = await decode(file);
  const s = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * s);
  const h = Math.round(bitmap.height * s);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  if ('close' in bitmap) (bitmap as ImageBitmap).close();
  return { imageData: ctx.getImageData(0, 0, w, h), dataUrl: canvas.toDataURL('image/jpeg', 0.82) };
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    // Screenshots carry an ICC profile. Firefox converts such pixels to sRGB by default, which
    // washes out the teal badges (chroma 29 -> 19) below the strong-colour threshold; the
    // recogniser is tuned for the raw pixels that Chrome and the Node tests see.
    try {
      return await createImageBitmap(file, { colorSpaceConversion: 'none' });
    } catch {
      /* option unsupported: fall back to the default decode */
    }
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall back to <img> (older Safari, unusual formats) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error('This file could not be read as an image.');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Runs recognition in a Web Worker so the UI stays responsive. */
export function recognizeInWorker(
  imageData: ImageData,
  onProgress: (stage: string, fraction: number) => void,
): Promise<RecognitionResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') onProgress(msg.stage, msg.fraction);
      else {
        worker.terminate();
        if (msg.type === 'done') resolve(msg.result);
        else reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Image analysis failed.'));
    };
    const buffer = imageData.data.buffer.slice(0);
    worker.postMessage({ width: imageData.width, height: imageData.height, buffer }, [buffer]);
  });
}
