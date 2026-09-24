import assert from "node:assert/strict";

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string };
}
interface EvaluationResult { result: { value?: unknown } }

const clientOrigin = process.env.MULTI_USER_CLIENT_ORIGIN ?? "http://localhost:5174";
const serverOrigin = process.env.MULTI_USER_SERVER_ORIGIN ?? "http://localhost:3540";
const mode = process.env.MULTI_USER_MODE ?? "development";
const targetResponse = await fetch(
  "http://127.0.0.1:9222/json/new?" + encodeURIComponent(clientOrigin + "/signup"),
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
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
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
  if (message.method === "Runtime.exceptionThrown") runtimeProblems.push("Uncaught browser exception");
  if (message.method === "Runtime.consoleAPICalled") {
    const type = message.params?.type;
    if (type === "error" || type === "assert") runtimeProblems.push("Browser console " + String(type));
  }
});

function send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise<T>((resolve, reject) => pending.set(id, { resolve: (value) => resolve(value as T), reject }));
}
async function evaluate<T>(functionSource: string): Promise<T> {
  const response = await send<EvaluationResult>("Runtime.evaluate", {
    expression: "Promise.resolve((" + functionSource + ")()).then((value) => JSON.stringify(value))",
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
  const body = await evaluate<string>("() => document.body.innerText.slice(0, 1200)");
  throw new Error("Timed out waiting for " + description + ": " + body);
}
async function setField(selector: string, value: string): Promise<void> {
  const changed = await evaluate<boolean>(`() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return false;
    const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }`);
  assert.equal(changed, true, "Field not found: " + selector);
}
async function activateButton(name: string): Promise<void> {
  const focused = await evaluate<boolean>(`() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === ${JSON.stringify(name)});
    if (!(button instanceof HTMLButtonElement)) return false;
    button.focus();
    return document.activeElement === button;
  }`);
  assert.equal(focused, true, "Button not found or not focusable: " + name);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
}
async function api<T>(path: string): Promise<{ status: number; body: T }> {
  return evaluate(`async () => {
    const response = await fetch(${JSON.stringify(serverOrigin)} + ${JSON.stringify(path)}, { credentials: "include" });
    return { status: response.status, body: await response.json() };
  }`);
}

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
await waitFor("document.body.innerText.includes('Create account')", "signup page");

const suffix = mode.replace(/[^a-z0-9]/gi, "").toLowerCase();
const userA = "browser-a-" + suffix + "@example.com";
const userB = "browser-b-" + suffix + "@example.com";
const password = "correct horse battery staple";

await setField('input[type="email"]', userA);
await setField('input[type="password"]', password);
await activateButton("Create account");
await waitFor("document.body.innerText.includes('Logout')", "authenticated dashboard");

await send("Page.navigate", { url: clientOrigin + "/meals/new" });
await waitFor("document.querySelector('input[name=food_name]')", "meal form");
const profile = await api<{ data: { today: string } }>("/api/v1/profile");
assert.equal(profile.status, 200);
await setField('input[name="food_name"]', "Private browser meal");
await setField('select[name="meal_type"]', "lunch");
await setField('input[name="consumption_date"]', profile.body.data.today);
await setField('input[name="consumed_quantity"]', "1");
await setField('select[name="quantity_unit"]', "serving");
await setField('input[name="calories_kcal"]', "123");
await setField('input[name="protein_g"]', "4");
await setField('input[name="carbs_g"]', "20");
await setField('input[name="fat_g"]', "3");
await activateButton("Save meal");
await waitFor("document.body.innerText.includes('Meal saved to your history.')", "meal save");

const listA = await api<{ pagination: { total_items: number }; items: Array<{ id: string; food_name: string }> }>("/api/v1/meals?page=1&page_size=20");
assert.equal(listA.status, 200);
assert.equal(listA.body.pagination.total_items, 1);
assert.equal(listA.body.items[0]?.food_name, "Private browser meal");
const mealId = listA.body.items[0]!.id;

await send("Page.navigate", { url: clientOrigin + "/reports" });
await waitFor("document.body.innerText.includes('Nutrition reports')", "reports page");
const report = await api<{ summary: { calories_kcal: number | null } }>("/api/v1/reports/nutrition?group_by=day&page=1&page_size=31");
assert.equal(report.status, 200);
assert.equal(report.body.summary.calories_kcal, 123);

await activateButton("Logout");
await waitFor("document.body.innerText.includes('Sign in')", "login after logout");
await setField('input[type="email"]', userA);
await setField('input[type="password"]', password);
await activateButton("Sign in");
await waitFor("document.body.innerText.includes('Logout')", "login recovery");
assert.equal((await api<{ pagination: { total_items: number } }>("/api/v1/meals?page=1&page_size=20")).body.pagination.total_items, 1);

await activateButton("Logout");
await waitFor("document.body.innerText.includes('Sign in')", "second logout");
await send("Page.navigate", { url: clientOrigin + "/signup" });
await waitFor("document.body.innerText.includes('Create account')", "second signup");
await setField('input[type="email"]', userB);
await setField('input[type="password"]', password);
await activateButton("Create account");
await waitFor("document.body.innerText.includes('Logout')", "second account");
const listB = await api<{ pagination: { total_items: number } }>("/api/v1/meals?page=1&page_size=20");
assert.equal(listB.status, 200);
assert.equal(listB.body.pagination.total_items, 0);
assert.equal((await api<Record<string, unknown>>("/api/v1/meals/" + mealId)).status, 404);

await send("Page.navigate", { url: clientOrigin + "/meals" });
await waitFor("document.body.innerText.includes('No meals') || !document.body.innerText.includes('Private browser meal')", "private empty history");
assert.equal((await evaluate<string>("() => document.body.innerText")).includes("Private browser meal"), false);
await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
await waitFor("innerWidth === 375 && document.documentElement.scrollWidth <= innerWidth", "narrow authenticated layout");
assert.deepEqual(runtimeProblems, []);

console.log("Multi-user " + mode + " browser flow passed: signup, private save/report, logout/login, account switch, keyboard, and narrow layout.");
await send("Page.close");
socket.close();
