import assert from "node:assert/strict";
import test from "node:test";

import { loadEnv } from "../src/config/env.js";

test("PORT defaults to 3000 when it is absent", () => {
  assert.deepEqual(loadEnv({}), { PORT: 3000 });
});

test("PORT accepts valid boundary and custom values", () => {
  for (const [input, expected] of [
    ["1", 1],
    ["3100", 3100],
    ["65535", 65535],
  ]) {
    assert.equal(loadEnv({ PORT: input }).PORT, expected);
  }
});

test("PORT rejects malformed and out-of-range values", () => {
  const invalidValues = ["", "   ", "abc", "0", "-1", "1.5", "65536"];

  for (const PORT of invalidValues) {
    assert.throws(
      () => loadEnv({ PORT }),
      /Invalid PORT: use an integer from 1 through 65535\./,
    );
  }
});
