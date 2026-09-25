import assert from "node:assert/strict";

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string };
}
interface EvaluationResult { result: { value?: unknown } }

const clientOrigin = "http://localhost:5175";
const serverOrigin = "http://localhost:3550";
const targetResponse = await fetch(
  "http://127.0.0.1:9222/json/new?" + encodeURIComponent(clientOrigin + "/login"),
  { method: "PUT" },
);
assert.equal(targetResponse.ok, true);
const target = await targetResponse.json() as { webSocketDebuggerUrl?: string };
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
  if (
    message.method === "Runtime.consoleAPICalled" &&
    (message.params?.type === "error" || message.params?.type === "assert")
  ) runtimeProblems.push("Browser console " + String(message.params.type));
});

function send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise<T>((resolve, reject) =>
    pending.set(id, { resolve: (value) => resolve(value as T), reject }),
  );
}
async function evaluate<T>(source: string): Promise<T> {
  const response = await send<EvaluationResult>("Runtime.evaluate", {
    expression: "Promise.resolve((" + source + ")()).then((value) => JSON.stringify(value))",
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(typeof response.result.value, "string");
  return JSON.parse(response.result.value as string) as T;
}
async function waitFor(expression: string, label: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await evaluate<boolean>("() => Boolean(" + expression + ")")) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const body = await evaluate<string>("() => document.body.innerText.slice(0, 1400)");
  throw new Error("Timed out waiting for " + label + ": " + body);
}
async function setInput(selector: string, value: string): Promise<void> {
  const changed = await evaluate<boolean>(`() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return false;
    const prototype = field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }`);
  assert.equal(changed, true, "Input missing: " + selector);
}
async function activateButton(name: string): Promise<void> {
  await waitFor(
    `[...document.querySelectorAll("button")].some(
      (button) => (button.textContent?.trim() || button.getAttribute("aria-label")) === ${JSON.stringify(name)}
        && !button.disabled,
    )`,
    "enabled button: " + name,
  );
  const result = await evaluate<{ focused: boolean; activated: boolean }>(`() => {
    const button = [...document.querySelectorAll("button")].find(
      (item) => (item.textContent?.trim() || item.getAttribute("aria-label")) === ${JSON.stringify(name)},
    );
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      return { focused: false, activated: false };
    }
    button.focus();
    const focused = document.activeElement === button;
    button.click();
    return { focused, activated: true };
  }`);
  assert.equal(result.focused, true, "Button is not keyboard-focusable: " + name);
  assert.equal(result.activated, true, "Button could not be activated: " + name);
}
async function api<T>(path: string): Promise<{ status: number; body: T }> {
  return evaluate(`async () => {
    const response = await fetch(${JSON.stringify(serverOrigin)} + ${JSON.stringify(path)}, {
      credentials: "include",
    });
    return { status: response.status, body: await response.json() };
  }`);
}
async function mealCount(): Promise<number> {
  const result = await api<{ pagination: { total_items: number } }>(
    "/api/v1/meals?page=1&page_size=20",
  );
  assert.equal(result.status, 200);
  return result.body.pagination.total_items;
}
async function sendChat(message: string): Promise<void> {
  await waitFor(
    `document.querySelector("#chat-message") instanceof HTMLTextAreaElement
      && !document.querySelector("#chat-message").disabled`,
    "enabled chat composer",
  );
  await setInput("#chat-message", message);
  await waitFor(
    `[...document.querySelectorAll("button")].some(
      (button) => button.getAttribute("aria-label") === "Send message" && !button.disabled,
    )`,
    "enabled chat send button",
  );
  await activateButton("Send message");
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1365, height: 900, deviceScaleFactor: 1, mobile: false,
});
await waitFor("document.body.innerText.includes('Sign in')", "login page");

const password = "correct horse battery staple";
await setInput('input[type="email"]', "chat-browser-a@example.com");
await setInput('input[type="password"]', password);
await activateButton("Sign in");
await waitFor(`document.querySelector(".nav-user")`, "authenticated app");

await send("Page.navigate", { url: clientOrigin + "/chat" });
await waitFor("document.body.innerText.includes('Nutrition chat')", "chat page");
const attachmentInsideComposer = await evaluate<boolean>(`() => {
  const button = document.querySelector('button[aria-label^="Attach nutrition"]');
  return button?.closest('form[aria-label="Chat message"]') !== null;
}`);
assert.equal(attachmentInsideComposer, true, "Attachment control must be inside the chat composer");
await activateButton("New conversation");
await waitFor("document.querySelector('#chat-message')", "chat composer");

await sendChat("I had 150 g of cooked rice for lunch today.");
await waitFor("document.body.innerText.includes('Review meal to save')", "meal proposal");
await waitFor(
  "document.querySelector('.conversation-list button')?.textContent?.includes('I had 150 g of cooked rice')",
  "meaningful conversation title",
);
assert.equal(await mealCount(), 0, "proposal must not save a meal");
await activateButton("Confirm");
await waitFor("document.body.innerText.includes('Confirmed')", "confirmed proposal");
assert.equal(await mealCount(), 1, "confirmed proposal must save once");

await sendChat("Show my calorie summary for today.");
await waitFor("document.body.innerText.includes('195 kcal')", "report-backed summary");

await sendChat("Delete Browser rice.");
await waitFor("document.body.innerText.includes('Review deletion')", "delete proposal");
await activateButton("Cancel");
await waitFor("document.body.innerText.includes('Canceled')", "canceled deletion");
assert.equal(await mealCount(), 1, "canceled deletion must preserve the meal");

await send("Page.navigate", { url: clientOrigin + "/profile" });
await waitFor("document.body.innerText.includes('Account actions')", "profile page");
await activateButton("Sign out");
await waitFor("document.body.innerText.includes('Sign in')", "signed out");

await waitFor("document.body.innerText.includes('Sign in')", "second login");
await setInput('input[type="email"]', "chat-browser-b@example.com");
await setInput('input[type="password"]', password);
await activateButton("Sign in");
await waitFor(`document.querySelector(".nav-user")`, "second account");
const privateChats = await api<{ pagination: { total_items: number } }>(
  "/api/v1/chat/conversations?page=1&page_size=20",
);
assert.equal(privateChats.status, 200);
assert.equal(privateChats.body.pagination.total_items, 0);

await send("Page.navigate", { url: clientOrigin + "/chat" });
await waitFor("document.body.innerText.includes('Nutrition chat')", "second chat page");
await send("Emulation.setDeviceMetricsOverride", {
  width: 375, height: 812, deviceScaleFactor: 1, mobile: false,
});
await waitFor(
  "innerWidth === 375 && document.documentElement.scrollWidth <= innerWidth",
  "narrow chat layout",
);
assert.deepEqual(runtimeProblems, []);

console.log("Chat browser flow passed: login, proposal, confirm, report, cancel, isolation, keyboard, and narrow layout.");
await send("Page.close");
socket.close();
