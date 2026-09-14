import { parentPort, workerData } from "node:worker_threads";

import sharp from "sharp";

interface WorkInput {
  bytes: Uint8Array;
  declaredMime: string;
}

type SupportedFormat = "jpeg" | "png" | "webp";
const FORMAT_MIME: Record<SupportedFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function fail(code: string): never {
  const error = new Error(code);
  error.name = "ImageWorkerError";
  throw error;
}

async function normalize(): Promise<void> {
  const input = workerData as WorkInput;
  const bytes = Buffer.from(input.bytes);
  const pipeline = sharp(bytes, {
    failOn: "warning",
    limitInputPixels: 25_000_000,
    unlimited: false,
    animated: true,
  });
  const metadata = await pipeline.metadata();
  if (!metadata.format || !(metadata.format in FORMAT_MIME)) {
    fail("UNSUPPORTED_FORMAT");
  }
  if (metadata.pages !== undefined && metadata.pages > 1) {
    fail("MULTI_FRAME");
  }
  if (FORMAT_MIME[metadata.format as SupportedFormat] !== input.declaredMime) {
    fail("MIME_MISMATCH");
  }

  const output = await pipeline
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({
      width: 3072,
      height: 3072,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 90 })
    // Sharp's native libvips timeout stops processing; the parent additionally
    // terminates the worker on its wall-clock deadline or caller cancellation.
    .timeout({ seconds: 5 })
    .toBuffer({ resolveWithObject: true });

  if (output.data.byteLength > 10_000_000) {
    fail("OUTPUT_TOO_LARGE");
  }
  parentPort?.postMessage({
    ok: true,
    bytes: output.data,
    width: output.info.width,
    height: output.info.height,
  });
}

void normalize().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "IMAGE_INVALID";
  parentPort?.postMessage({ ok: false, code: message });
});
