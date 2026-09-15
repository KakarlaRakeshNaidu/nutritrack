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

const clientOrigin = process.env.STAGEA_CLIENT_ORIGIN ?? "http://localhost:5173";
const serverOrigin = process.env.STAGEA_SERVER_ORIGIN ?? "http://localhost:3420";
const targetResponse = await fetch(
  "http://127.0.0.1:9222/json/new?" + encodeURIComponent(clientOrigin + "/meals/new"),
  { method: "PUT" },
);
assert.equal(targetResponse.ok, true, "Chromium CDP target could not be created.");
const target = (await targetResponse.json()) as { webSocketDebuggerUrl?: string };
assert.equal(typeof target.webSocketDebuggerUrl, "string");

const socket = new WebSocket(target.webSocketDebuggerUrl!);
await new Promise<void>((resolve, reject) => {
  socket.addEventListener("open", () => resolve(), { once: true });
  socket.addEventListener("error", () => reject(new Error("CDP socket failed.")), { once: true });
});

let nextId = 0;
let estimateRequests = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
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
  if (message.method === "Network.requestWillBeSent") {
    const request = message.params?.request as { url?: unknown; method?: unknown } | undefined;
    if (
      request?.url === serverOrigin + "/api/v1/nutrition/estimate" &&
      request.method === "POST"
    ) {
      estimateRequests += 1;
    }
  }
  if (message.method === "Runtime.exceptionThrown") runtimeProblems.push("Uncaught browser exception");
  if (
    message.method === "Runtime.consoleAPICalled" &&
    (message.params?.type === "error" || message.params?.type === "assert")
  ) {
    runtimeProblems.push("Browser console " + String(message.params.type));
  }
});

function send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: (value) => resolve(value as T), reject });
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
  const body = await evaluate<string>("() => document.body.innerText.slice(0, 1_000)");
  throw new Error("Timed out waiting for " + description + ": " + body);
}

async function setField(label: string, value: string): Promise<void> {
  const changed = await evaluate<boolean>(`() => {
    const fieldLabel = [...document.querySelectorAll("label")].find(
      (item) => item.querySelector("span")?.textContent?.trim().startsWith(${JSON.stringify(label)}),
    );
    const field = fieldLabel?.querySelector("input, select");
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return false;
    const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }`);
  assert.equal(changed, true, "Field not found: " + label);
}

async function fieldValue(label: string): Promise<string> {
  return evaluate<string>(`() => {
    const fieldLabel = [...document.querySelectorAll("label")].find(
      (item) => item.querySelector("span")?.textContent?.trim().startsWith(${JSON.stringify(label)}),
    );
    const field = fieldLabel?.querySelector("input, select");
    return field instanceof HTMLInputElement || field instanceof HTMLSelectElement ? field.value : "";
  }`);
}

async function activateButton(name: string): Promise<void> {
  const focused = await evaluate<boolean>(`() => {
    const button = [...document.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === ${JSON.stringify(name)},
    );
    if (!(button instanceof HTMLButtonElement)) return false;
    button.focus();
    return document.activeElement === button;
  }`);
  assert.equal(focused, true, "Button could not receive focus: " + name);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
}

async function mealCount(): Promise<number> {
  const response = await fetch(serverOrigin + "/api/v1/meals?page=1&page_size=100");
  assert.equal(response.ok, true);
  const payload = (await response.json()) as { pagination?: { total_items?: unknown } };
  const totalItems = payload.pagination?.total_items;
  assert.equal(typeof totalItems, "number");
  return totalItems as number;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
await waitFor("document.body.innerText.includes('Add a meal')", "meal form");
await waitFor("document.querySelector('input[name=food_name]')", "meal form fields");
assert.equal(await mealCount(), 25);
assert.equal(estimateRequests, 0, "Opening and editing the form must not call Gemini.");

await setField("Food name", "Cooked brown rice");
await setField("Meal type", "lunch");
await setField("Consumption date", "2026-09-12");
await setField("Consumed quantity", "200");
await setField("Quantity unit", "g");
assert.equal(estimateRequests, 0, "Changing meal basics must not call Gemini.");
await activateButton("Estimate nutrition");
await waitFor("document.body.innerText.includes('AI estimate applied')", "editable estimate");
assert.equal(estimateRequests, 1);
assert.equal(await mealCount(), 25, "Estimation must not persist a meal.");
assert.equal(await fieldValue("Food name"), "Cooked brown rice");
assert.equal(await fieldValue("Calories"), "216");
assert.equal(await fieldValue("Vitamin C"), "0");
assert.equal(await fieldValue("Calcium"), "");
assert.match(await evaluate<string>("() => document.body.innerText"), /AI-estimated from meal details[\s\S]*Manual identifies the entry method/);

await setField("Calories", "230");
await setField("Protein", "6");
assert.equal(await evaluate<string>("() => document.querySelector('input[name=entry_source]')?.value ?? ''"), "manual");
assert.equal(await evaluate<string>("() => document.querySelector('input[name=is_estimate]')?.value ?? ''"), "true");
await activateButton("Save meal");
await waitFor("document.body.innerText.includes('Meal saved to your history.')", "explicit save");
assert.equal(await mealCount(), 26);

await send("Page.reload");
await waitFor("document.body.innerText.includes('Cooked brown rice')", "saved meal after reload");
const savedResponse = await fetch(serverOrigin + "/api/v1/meals?page=1&page_size=100");
const savedPayload = (await savedResponse.json()) as { items?: Array<Record<string, unknown>> };
const saved = savedPayload.items?.find((item) => item.food_name === "Cooked brown rice");
assert.ok(saved);
assert.equal(saved.calories_kcal, 230);
assert.equal(saved.protein_g, 6);
const savedMicronutrients = saved.micronutrients as Record<string, unknown> | undefined;
assert.equal(savedMicronutrients?.calcium_mg, null);
assert.equal(savedMicronutrients?.vitamin_c_mg, 0);
assert.equal(saved.entry_source, "manual");
assert.equal(saved.is_estimate, true);

await send("Page.navigate", { url: clientOrigin + "/" });
await waitFor("document.body.innerText.includes('Current-week logged totals')", "dashboard report");
await waitFor("/480\\s*kcal/.test(document.body.innerText)", "saved estimate in report totals");
await send("Emulation.setDeviceMetricsOverride", {
  width: 375,
  height: 812,
  deviceScaleFactor: 1,
  mobile: false,
});
await waitFor(
  "innerWidth === 375 && document.documentElement.scrollWidth <= innerWidth",
  "settled narrow layout",
);
const layout = await evaluate<{ width: number; scrollWidth: number }>(
  "() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })",
);
assert.equal(layout.width, 375);
assert.equal(layout.scrollWidth <= layout.width, true);
assert.deepEqual(runtimeProblems, []);
console.log("Stage A browser checks passed: explicit estimate, editable prefill, no pre-save write, save/reload/report, keyboard, and narrow layout.");
await send("Page.close");
socket.close();
