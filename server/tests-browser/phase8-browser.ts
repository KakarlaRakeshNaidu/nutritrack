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

interface BrowserSnapshot {
  body: string;
  href: string;
  width: number;
  scrollWidth: number;
  chartCount: number;
  chartSizes: Array<{ width: number; height: number }>;
  values: Record<string, string>;
}

const clientOrigin = process.env.PHASE8_CLIENT_ORIGIN ?? "http://localhost:5173";

const targetResponse = await fetch(
  "http://127.0.0.1:9222/json/new?" + encodeURIComponent(clientOrigin + "/"),
  { method: "PUT" },
);
assert.equal(targetResponse.ok, true, "Chromium CDP target could not be created.");
const target = (await targetResponse.json()) as { webSocketDebuggerUrl?: string };
const webSocketDebuggerUrl = target.webSocketDebuggerUrl;
if (typeof webSocketDebuggerUrl !== "string") {
  throw new Error("Chromium did not provide a debugger URL.");
}

const socket = new WebSocket(webSocketDebuggerUrl);
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
    if (message.error) {
      request.reject(new Error(message.error.message ?? "Unknown CDP failure."));
    } else {
      request.resolve(message.result);
    }
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    runtimeProblems.push("Uncaught browser exception");
  }
  if (message.method === "Runtime.consoleAPICalled") {
    const type = message.params?.type;
    if (type === "error" || type === "assert") {
      runtimeProblems.push("Browser console " + String(type));
    }
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
  const value = response.result.value;
  if (typeof value !== "string") {
    throw new Error("Browser evaluation failed: " + JSON.stringify(response));
  }
  return JSON.parse(value) as T;
}

async function waitForText(text: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const found = await evaluate<boolean>(
      "() => document.readyState === 'complete' && document.body.innerText.includes(" +
        JSON.stringify(text) +
        ")",
    );
    if (found) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const state = await evaluate<{ href: string; body: string }>(
    "() => ({ href: location.href, body: document.body.innerText.slice(0, 500) })",
  );
  throw new Error("Timed out waiting for " + text + ": " + JSON.stringify(state));
}

async function waitForCharts(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = await evaluate<boolean>(`() => {
      const charts = [...document.querySelectorAll("[data-chart]")];
      return charts.length >= 2 && charts.every((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && element.querySelector("svg") !== null;
      });
    }`);
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for non-zero report charts.");
}

async function navigate(url: string, expectedText: string): Promise<void> {
  await send("Page.navigate", { url });
  await waitForText(expectedText);
}

async function setViewport(width: number, height: number): Promise<void> {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width <= 375,
  });
}

async function snapshot(): Promise<BrowserSnapshot> {
  return evaluate<BrowserSnapshot>(`() => ({
    body: document.body.innerText,
    href: location.href,
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    chartCount: document.querySelectorAll("[data-chart] svg").length,
    chartSizes: [...document.querySelectorAll("[data-chart]")].map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }),
    values: Object.fromEntries(
      [...document.querySelectorAll("input, select")].map((element) => [
        element.getAttribute("aria-label") ||
          element.closest("label")?.firstChild?.textContent?.trim() ||
          element.tagName,
        element.value,
      ]),
    ),
  })`);
}

async function clickButton(name: string): Promise<void> {
  const clicked = await evaluate<boolean>(
    `() => {
      const element = [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === ${JSON.stringify(name)},
      );
      if (!(element instanceof HTMLButtonElement)) return false;
      element.click();
      return true;
    }`,
  );
  assert.equal(clicked, true, "Button not found: " + name);
}

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await setViewport(1440, 1000);

await navigate(clientOrigin + "/", "Current-week logged totals");
await waitForCharts();
let current = await snapshot();
assert.match(current.body, /25 entries across 1 logged day/);
assert.match(current.body, /250\s+kcal/);
assert.match(current.body, /120\s+mg/);
assert.match(current.body, /Future/);
assert.match(current.body, /Saved target weight: 75 kg/);
assert.equal(current.chartCount >= 2, true);
assert.equal(current.chartSizes.every((size) => size.width > 0 && size.height > 0), true);
assert.equal(current.scrollWidth <= current.width, true);

await navigate(
  clientOrigin + "/reports?start_date=2026-09-07&end_date=2026-11-05&group_by=day&page=2&page_size=20",
  "Showing 21–40 of 60 days.",
);
current = await snapshot();
assert.match(current.body, /Full-range totals/);
assert.match(current.body, /250\s+kcal/);
assert.match(current.body, /Page 2 of 3/);
assert.equal(current.values["Start date"], "2026-09-07");
assert.equal(current.values["End date"], "2026-11-05");
assert.equal(current.values["Group by"], "day");
assert.equal(current.values["Buckets per page"], "20");
await clickButton("Previous");
await waitForText("Page 1 of 3");
assert.match((await snapshot()).href, /page=1/);

await navigate(
  clientOrigin + "/reports?start_date=2026-09-07&end_date=2026-11-05&group_by=day&page=99&page_size=20",
  "No periods on this page",
);
current = await snapshot();
assert.match(current.body, /250\s+kcal/);
assert.match(current.body, /Full-range panels above do not change with chart pages/);

await navigate(
  clientOrigin + "/reports?start_date=2026-09-10&meal_type=lunch",
  "URL contains invalid report parameters",
);
current = await snapshot();
assert.equal(current.values["Start date"], "2026-09-10");
assert.match(current.body, /Reset to current week/);

for (const [path, text] of [
  ["/meals", "Meal history"],
  ["/meals/new", "Add a meal"],
  ["/goals", "Goals"],
] as const) {
  await navigate(clientOrigin + path, text);
}

await setViewport(375, 812);
await navigate(clientOrigin + "/", "Current-week logged totals");
await waitForCharts();
current = await snapshot();
assert.equal(current.width, 375);
assert.equal(current.scrollWidth <= current.width, true);
assert.equal(current.chartCount >= 2, true);
assert.equal(current.chartSizes.every((size) => size.width > 0 && size.height > 0), true);

await navigate(
  clientOrigin + "/reports?start_date=2026-09-07&end_date=2026-09-13&group_by=day&page=1&page_size=20",
  "Paginated chart buckets",
);
await waitForCharts();
current = await snapshot();
assert.equal(current.scrollWidth <= current.width, true);
assert.equal(current.chartCount >= 2, true);
assert.equal(current.chartSizes.every((size) => size.width > 0 && size.height > 0), true);

assert.deepEqual(runtimeProblems, []);
console.log(
  "Phase 8 browser checks passed: real API, charts, URL states, manual routes, 1440px and 375px.",
);
socket.close();
