import { recognize } from './recognize';

export type WorkerRequest = { width: number; height: number; buffer: ArrayBuffer };
export type WorkerResponse =
  | { type: 'progress'; stage: string; fraction: number }
  | { type: 'done'; result: Awaited<ReturnType<typeof recognize>> }
  | { type: 'error'; message: string };

// Minimal worker scope typing (the project compiles against the DOM lib).
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (msg: WorkerResponse) => void;
};

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { width, height, buffer } = e.data;
  try {
    const result = await recognize(
      { width, height, data: new Uint8ClampedArray(buffer) },
      { onProgress: (stage, fraction) => ctx.postMessage({ type: 'progress', stage, fraction } satisfies WorkerResponse) },
    );
    ctx.postMessage({ type: 'done', result } satisfies WorkerResponse);
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies WorkerResponse);
  }
};
