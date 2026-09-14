import { Worker } from "node:worker_threads";

import { cancellationFailure } from "./nutrition.failures.js";

export const MAX_IMAGE_BYTES = 10_000_000;
export const IMAGE_PROCESSING_TIMEOUT_MS = 5_000;
export const SUPPORTED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export class ImageProcessingError extends Error {
  readonly code: "invalid" | "unsupported";

  constructor(code: "invalid" | "unsupported", message: string) {
    super(message);
    this.name = "ImageProcessingError";
    this.code = code;
  }
}

interface WorkerMessage {
  ok: boolean;
  bytes?: Uint8Array;
  code?: string;
  width?: number;
  height?: number;
}

export interface NormalizedImage {
  buffer: Buffer;
  width: number;
  height: number;
  mime: "image/jpeg";
}

export async function normalizeImage(
  input: Buffer,
  declaredMime: string,
  signal: AbortSignal,
  timeoutMs = IMAGE_PROCESSING_TIMEOUT_MS,
): Promise<NormalizedImage> {
  if (signal.aborted) {
    throw cancellationFailure(signal.reason);
  }

  const exactBytes = Uint8Array.from(input);
  const workerEntry = new URL(
    import.meta.url.endsWith(".ts") ? "./image-worker.ts" : "./image-worker.js",
    import.meta.url,
  );
  const worker = new Worker(workerEntry, {
    workerData: { bytes: exactBytes, declaredMime },
    transferList: [exactBytes.buffer],
    execArgv: import.meta.url.endsWith(".ts") ? ["--import", "tsx"] : [],
  });

  return await new Promise<NormalizedImage>((resolve, reject) => {
    let settled = false;
    const deadline = setTimeout(() => {
      void finish(new ImageProcessingError("invalid", "Image processing timed out."));
    }, timeoutMs);
    deadline.unref();

    const onAbort = (): void => {
      void finish(cancellationFailure(signal.reason));
    };

    // Concurrency ownership is released only after this promise settles. Every
    // path awaits worker termination, so abandoned native image work never runs
    // after the protected extraction slot is returned.
    async function finish(error?: unknown, value?: NormalizedImage): Promise<void> {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      signal.removeEventListener("abort", onAbort);
      worker.removeAllListeners();
      await worker.terminate();
      if (error) {
        reject(error);
      } else if (value) {
        resolve(value);
      } else {
        reject(new ImageProcessingError("invalid", "Image processing failed."));
      }
    }

    signal.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (message: WorkerMessage) => {
      if (!message.ok || !message.bytes) {
        const unsupported =
          message.code === "UNSUPPORTED_FORMAT" || message.code === "MIME_MISMATCH";
        void finish(
          new ImageProcessingError(
            unsupported ? "unsupported" : "invalid",
            "Image bytes could not be safely processed.",
          ),
        );
        return;
      }
      void finish(undefined, {
        buffer: Buffer.from(message.bytes),
        width: message.width ?? 0,
        height: message.height ?? 0,
        mime: "image/jpeg",
      });
    });
    worker.once("error", (error) => {
      void finish(new ImageProcessingError("invalid", error.message));
    });
    worker.once("exit", (code) => {
      if (!settled) {
        void finish(
          new ImageProcessingError("invalid", `Image worker exited with code ${code}.`),
        );
      }
    });
  });
}
