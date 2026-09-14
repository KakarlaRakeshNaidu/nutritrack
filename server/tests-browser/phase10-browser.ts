import assert from "node:assert/strict";

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string };
}

interface EvaluationResult {
  result: { value?: unknown };
}

const clientOrigin = process.env.PHASE10_CLIENT_ORIGIN ?? "http://localhost:5173";
const serverOrigin = process.env.PHASE10_SERVER_ORIGIN ?? "http://localhost:3420";
const imageFixture =
  process.env.PHASE10_IMAGE_FIXTURE ??
  "\\\\wsl.localhost\\Ubuntu-24.04-Verify\\home\\rakeshnaidu\\rakesh_linux\\NutriTrack\\server\\support\\fixtures\\phase9-live-plate.png";

const targetResponse = await fetch(
  "http://127.0.0.1:9222/json/new?" +
    encodeURIComponent(clientOrigin + "/meals/from-image"),
  { method: "PUT" },
);
assert.equal(targetResponse.ok, true, "Chromium CDP target could not be created.");
const target = (await targetResponse.json()) as { webSocketDebuggerUrl?: string };
assert.equal(typeof target.webSocketDebuggerUrl, "string");

const socket = new WebSocket(target.webSocketDebuggerUrl!);
await new Promise<void>((resolve, reject) => {
  socket.addEventListener("open", () => resolve(), { once: true });
  socket.addEventListener("error", () => reject(new Error("CDP socket failed.")), {
    once: true,
  });
});

let nextId = 0;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
const runtimeProblems: string[] = [];

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data)) as CdpMessage;
  if (message.id !== undefined) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    runtimeProblems.push("Uncaught browser exception");
  }
  if (
    message.method === "Runtime.consoleAPICalled" &&
    (message.params?.type === "error" || message.params?.type === "assert")
  ) {
    runtimeProblems.push("Browser console " + String(message.params.type));
  }
});

function send<T>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    });
  });
}

async function evaluate<T>(expression: string): Promise<T> {
  const response = await send<EvaluationResult>("Runtime.evaluate", {
    expression: "JSON.stringify((" + expression + ")())",
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(typeof response.result.value, "string");
  return JSON.parse(response.result.value as string) as T;
}

async function waitFor(expression: string, description: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await evaluate<boolean>("() => Boolean(" + expression + ")")) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const body = await evaluate<string>("() => document.body.innerText.slice(0, 800)");
  throw new Error("Timed out waiting for " + description + ": " + body);
}

async function navigate(path: string, expectedText: string): Promise<void> {
  await send("Page.navigate", { url: clientOrigin + path });
  await waitFor(
    "document.readyState === 'complete' && document.body.innerText.includes(" +
      JSON.stringify(expectedText) +
      ")",
    expectedText,
  );
}

async function clickButton(name: string): Promise<void> {
  const clicked = await evaluate<boolean>(
    `() => {
      const button = [...document.querySelectorAll("button")].find(
        (item) => item.textContent?.trim() === ${JSON.stringify(name)},
      );
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    }`,
  );
  assert.equal(clicked, true, "Button not found: " + name);
}

async function activateButtonWithKeyboard(name: string): Promise<void> {
  const focused = await evaluate<boolean>(
    `() => {
      const button = [...document.querySelectorAll("button")].find(
        (item) => item.textContent?.trim() === ${JSON.stringify(name)},
      );
      if (!(button instanceof HTMLButtonElement)) return false;
      button.focus();
      return document.activeElement === button;
    }`,
  );
  assert.equal(focused, true, "Button could not receive focus: " + name);
  await send("Input.dispatchKeyEvent", {
    type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32,
  });
}

async function setField(label: string, value: string): Promise<void> {
  const changed = await evaluate<boolean>(
    `() => {
      const fieldLabel = [...document.querySelectorAll("label")].find(
        (item) => item.querySelector("span")?.textContent?.trim().startsWith(
          ${JSON.stringify(label)},
        ),
      );
      const field = fieldLabel?.querySelector("input, select");
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) {
        return false;
      }
      const prototype = field instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, ${JSON.stringify(value)});
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }`,
  );
  assert.equal(changed, true, "Field not found: " + label);
}

async function fieldValue(label: string): Promise<string> {
  return evaluate<string>(
    `() => {
      const fieldLabel = [...document.querySelectorAll("label")].find(
        (item) => item.querySelector("span")?.textContent?.trim().startsWith(
          ${JSON.stringify(label)},
        ),
      );
      const field = fieldLabel?.querySelector("input, select");
      return field instanceof HTMLInputElement || field instanceof HTMLSelectElement
        ? field.value
        : "";
    }`,
  );
}

async function chooseImage(): Promise<void> {
  const documentNode = await send<{ root: { nodeId: number } }>("DOM.getDocument");
  const input = await send<{ nodeId: number }>("DOM.querySelector", {
    nodeId: documentNode.root.nodeId,
    selector: 'input[type="file"]',
  });
  assert.notEqual(input.nodeId, 0, "Image input was not found.");
  await send("DOM.setFileInputFiles", {
    nodeId: input.nodeId,
    files: [imageFixture],
  });
  await waitFor(
    "document.body.innerText.includes('Ready to analyze when you choose.')",
    "selected image",
  );
}

async function mealCount(): Promise<number> {
  const response = await fetch(serverOrigin + "/api/v1/meals?page=1&page_size=100");
  assert.equal(response.ok, true);
  const payload = (await response.json()) as {
    pagination?: { total_items?: number };
  };
  assert.equal(typeof payload.pagination?.total_items, "number");
  return payload.pagination!.total_items!;
}

async function persistedMeal(foodName: string): Promise<{
  consumed_quantity: number;
  calories_kcal: number;
  entry_source: string;
  is_estimate: boolean;
}> {
  const response = await fetch(serverOrigin + "/api/v1/meals?page=1&page_size=100");
  assert.equal(response.ok, true);
  const payload = (await response.json()) as {
    items?: Array<{
      food_name?: string;
      consumed_quantity?: number;
      calories_kcal?: number;
      entry_source?: string;
      is_estimate?: boolean;
    }>;
  };
  const meal = payload.items?.find((item) => item.food_name === foodName);
  assert.ok(meal, "Saved meal was not returned after reload: " + foodName);
  assert.equal(typeof meal.consumed_quantity, "number");
  assert.equal(typeof meal.calories_kcal, "number");
  assert.equal(typeof meal.entry_source, "string");
  assert.equal(typeof meal.is_estimate, "boolean");
  return {
    consumed_quantity: meal.consumed_quantity,
    calories_kcal: meal.calories_kcal,
    entry_source: meal.entry_source,
    is_estimate: meal.is_estimate,
  };
}

await send("Page.enable");
await send("Runtime.enable");
await send("DOM.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});

await waitFor(
  "document.body.innerText.includes('Log a meal from a photo')",
  "image workflow",
);
assert.equal(await mealCount(), 25);
await chooseImage();
assert.equal(await mealCount(), 25, "Selection must not persist a meal.");
await activateButtonWithKeyboard("Analyze image");
await waitFor(
  "document.body.innerText.includes('Review and complete the meal')",
  "label draft",
);
assert.equal(await mealCount(), 25, "Analysis must not persist a meal.");
assert.equal(await fieldValue("Food name"), "Simulated label meal");
assert.equal(await fieldValue("Meal type"), "");
assert.equal(await fieldValue("Iron (mg) optional"), "0");
assert.equal(await fieldValue("Calcium (mg) optional"), "");
assert.match(
  await evaluate<string>("() => document.body.innerText"),
  /Nutrition label photo[\s\S]*Saved as label-derived nutrition/,
);
await setField("Meal type", "lunch");
await setField("Consumed quantity", "2");
assert.equal(await fieldValue("Calories (kcal)"), "250");

await send("Network.setBlockedURLs", {
  urls: [serverOrigin + "/api/v1/meals"],
});
await clickButton("Save meal");
await waitFor(
  "document.body.innerText.includes('Could not confirm the save')",
  "failed save guidance",
);
assert.equal(await fieldValue("Food name"), "Simulated label meal");
assert.equal(await mealCount(), 25);
await send("Network.setBlockedURLs", { urls: [] });
await clickButton("Save meal");
await waitFor(
  "document.body.innerText.includes('Photo meal saved to your history.')",
  "label save",
);
assert.equal(await mealCount(), 26);
await send("Page.reload");
await waitFor(
  "document.body.innerText.includes('Simulated label meal')",
  "reloaded label history",
);
assert.deepEqual(await persistedMeal("Simulated label meal"), {
  consumed_quantity: 2,
  calories_kcal: 250,
  entry_source: "nutrition_label",
  is_estimate: false,
});

await navigate("/meals/from-image", "Log a meal from a photo");
await setField("Image mode", "food_plate");
await chooseImage();
await clickButton("Analyze image");
await waitFor(
  "document.querySelector('input[name=food_name]')?.value === 'Simulated plate meal'",
  "plate draft",
);
assert.match(
  await evaluate<string>("() => document.body.innerText"),
  /Plate photo[\s\S]*Saved as an estimate/,
);
await setField("Meal type", "dinner");
await setField("Consumed quantity", "2");
assert.equal(await fieldValue("Calories (kcal)"), "500");
await setField("Food name", "Edited plate meal");
await evaluate<boolean>("() => { window.confirm = () => false; return true; }");
await setField("Image mode", "nutrition_label");
assert.equal(await fieldValue("Image mode"), "food_plate");
assert.equal(await fieldValue("Food name"), "Edited plate meal");

await evaluate<boolean>("() => { window.confirm = () => true; return true; }");
await clickButton("Analyze image");
await waitFor(
  "document.body.innerText.includes('Cancel analysis')",
  "cancel control",
);
// Let the real multipart request reach the injected provider before canceling.
await new Promise((resolve) => setTimeout(resolve, 2_000));
await activateButtonWithKeyboard("Cancel analysis");
await new Promise((resolve) => setTimeout(resolve, 300));
assert.equal(await fieldValue("Food name"), "Edited plate meal");

await clickButton("Analyze image");
await waitFor(
  "document.body.innerText.includes('Image analysis unavailable')",
  "simulated provider failure",
);
assert.equal(await fieldValue("Food name"), "Edited plate meal");
assert.match(
  await evaluate<string>("() => document.body.innerText"),
  /Enter manually/,
);
await clickButton("Try again");
await waitFor(
  "!document.body.innerText.includes('Image analysis unavailable') && " +
    "document.querySelector('input[name=food_name]')?.value === 'Simulated plate meal'",
  "successful retry",
);
await setField("Meal type", "dinner");
await activateButtonWithKeyboard("Save meal");
await waitFor(
  "document.body.innerText.includes('Photo meal saved to your history.')",
  "plate save",
);
assert.equal(await mealCount(), 27);
await send("Page.reload");
await waitFor(
  "document.body.innerText.includes('Simulated plate meal')",
  "reloaded plate history",
);
assert.deepEqual(await persistedMeal("Simulated plate meal"), {
  consumed_quantity: 1,
  calories_kcal: 500,
  entry_source: "food_plate",
  is_estimate: true,
});

await navigate("/", "Current-week logged totals");
await waitFor(
  "/1,000\\s*kcal/.test(document.body.innerText)",
  "saved meals in reports",
);
await navigate("/meals/from-image", "Log a meal from a photo");
await chooseImage();
await send("Page.reload");
await waitFor(
  "document.body.innerText.includes('No image selected.')",
  "refresh reset",
);
await evaluate<boolean>("() => { history.back(); return true; }");
await new Promise((resolve) => setTimeout(resolve, 300));
await evaluate<boolean>("() => { history.forward(); return true; }");
await waitFor(
  "document.body.innerText.includes('Log a meal from a photo')",
  "history navigation",
);

await send("Emulation.setDeviceMetricsOverride", {
  width: 375,
  height: 812,
  deviceScaleFactor: 1,
  mobile: true,
});
const layout = await evaluate<{ width: number; scrollWidth: number }>(
  "() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })",
);
assert.equal(layout.width, 375);
assert.equal(layout.scrollWidth <= layout.width, true);
assert.deepEqual(runtimeProblems, []);
console.log(
  "Phase 10 browser checks passed: label, plate, cancel, failure/retry, failed save, reports, navigation, and responsive layout.",
);
socket.close();
