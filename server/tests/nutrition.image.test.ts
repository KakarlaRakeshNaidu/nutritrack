import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  ImageProcessingError,
  normalizeImage,
} from "../src/modules/nutrition/image-processing.js";
import { ProviderFailure } from "../src/modules/nutrition/nutrition.failures.js";

async function image(format: "jpeg" | "png" | "webp", width = 20, height = 10) {
  const pipeline = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 12, g: 34, b: 56, alpha: 0.5 },
    },
  });
  return await pipeline[format]().toBuffer();
}

for (const [format, mime] of [
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
] as const) {
  test(`${format} decodes and normalizes to the same bounded JPEG contract`, async () => {
    const result = await normalizeImage(
      await image(format),
      mime,
      new AbortController().signal,
    );
    const metadata = await sharp(result.buffer).metadata();
    assert.equal(result.mime, "image/jpeg");
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.width, 20);
    assert.equal(metadata.height, 10);
    assert(result.buffer.byteLength <= 10_000_000);
  });
}

test("image normalization rejects MIME spoofing and corrupt bytes", async () => {
  await assert.rejects(
    normalizeImage(await image("png"), "image/jpeg", new AbortController().signal),
    (error) => error instanceof ImageProcessingError && error.code === "unsupported",
  );
  await assert.rejects(
    normalizeImage(Buffer.from("not an image"), "image/png", new AbortController().signal),
    (error) => error instanceof ImageProcessingError && error.code === "invalid",
  );
});

test("image normalization rejects animated input and the decode pixel limit", async () => {
  const red = await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toBuffer();
  const blue = await sharp({ create: { width: 2, height: 2, channels: 4, background: "blue" } }).png().toBuffer();
  const animated = await sharp([red, blue], { join: { animated: true } })
    .webp({ loop: 0, delay: [100, 100] }).toBuffer();
  await assert.rejects(
    normalizeImage(animated, "image/webp", new AbortController().signal),
    ImageProcessingError,
  );

  const hugeHeader = await sharp({
    create: {
      width: 5001,
      height: 5000,
      channels: 3,
      background: "white",
    },
  }).png().toBuffer();
  await assert.rejects(
    normalizeImage(hugeHeader, "image/png", new AbortController().signal),
    ImageProcessingError,
  );
});

test("orientation, transparency flattening, and maximum fit are applied", async () => {
  const oriented = await sharp({
    create: {
      width: 3200,
      height: 100,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await normalizeImage(
    oriented,
    "image/jpeg",
    new AbortController().signal,
  );
  const metadata = await sharp(result.buffer).metadata();
  assert((metadata.width ?? 0) <= 3072);
  assert((metadata.height ?? 0) <= 3072);
  assert.equal(metadata.channels, 3);
});

test("processing deadline and caller cancellation terminate the worker", async () => {
  await assert.rejects(
    normalizeImage(await image("png", 100, 100), "image/png", new AbortController().signal, 0),
    ImageProcessingError,
  );
  const controller = new AbortController();
  controller.abort("test-disconnect");
  await assert.rejects(
    normalizeImage(await image("png"), "image/png", controller.signal),
    (error) => error instanceof ProviderFailure && error.kind === "user_cancellation",
  );
});
