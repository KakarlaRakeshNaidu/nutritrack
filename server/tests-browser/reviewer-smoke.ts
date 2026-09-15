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

const clientOrigin = process.env.REVIEW_CLIENT_ORIGIN ?? "http://localhost:4173";
const serverOrigin = process.env.REVIEW_SERVER_ORIGIN ?? "http://localhost:3421";
const response = await fetch(
  "http://127.0.0.1:9222/json/new?" + encodeURIComponent(clientOrigin + "/meals/new"),
  { method: "PUT" },
);
assert.equal(response.ok, true);
const target = (await response.json()) as { webSocketDebuggerUrl?: string };
assert.equal(typeof target.webSocketDebuggerUrl, "string");
const socket = new WebSocket(target.webSocketDebuggerUrl!);
await new Promise<void>((resolve, reject) => {
  socket.addEventListener("open", () => resolve(), { once: true });
  socket.addEventListener("error", () => reject(new Error("CDP socket failed.")), { once: true });
});

let nextId = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const apiRequests = new Set<string>();
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
    const request = message.params?.request as { url?: unknown } | undefined;
    if (typeof request?.url === "string" && request.url.startsWith(serverOrigin + "/api/v1/")) {
      apiRequests.add(request.url);
    }
  }
  if (message.method === "Runtime.exceptionThrown") runtimeProblems.push("Uncaught browser exception");
  if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
    runtimeProblems.push("Browser console error");
  }
});

function send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise<T>((resolve, reject) => pending.set(id, {
    resolve: (value) => resolve(value as T),
    reject,
  }));
}

async function evaluate<T>(expression: string): Promise<T> {
  const result = await send<EvaluationResult>("Runtime.evaluate", {
    expression: "JSON.stringify((" + expression + ")())",
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(typeof result.result.value, "string");
  return JSON.parse(result.result.value as string) as T;
}

async function waitFor(expression: string, description: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await evaluate<boolean>("() => Boolean(" + expression + ")")) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for " + description);
}

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await waitFor("document.querySelector('input[name=food_name]')", "direct meal route");
assert.equal(apiRequests.has(serverOrigin + "/api/v1/profile"), true);
await send("Page.reload");
await waitFor("document.querySelector('input[name=food_name]')", "meal route refresh");
await send("Page.navigate", { url: clientOrigin + "/reports" });
await waitFor("document.body.innerText.includes('Nutrition reports')", "reports route");
await send("Page.reload");
await waitFor("document.body.innerText.includes('Nutrition reports')", "reports refresh");
assert.equal(
  [...apiRequests].some((url) => url.startsWith(serverOrigin + "/api/v1/reports/nutrition")),
  true,
);
assert.deepEqual(runtimeProblems, []);
console.log("Reviewer browser smoke passed: built client API boundary, direct routes, and refresh.");
await send("Page.close");
socket.close();
