import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";

import { createApp } from "../src/app.js";
import { databasePoolStub, recordingLogger, testConfig } from "../support/testing.js";
import type { DatabaseExecutor } from "../src/types.js";

const ORIGIN = "http://localhost:5173";
const PASSWORD = "correct horse battery staple";
const config = {
  ...testConfig(),
  JWT_SECRET: "test-only-jwt-secret-with-at-least-32-characters",
};

function authHarness() {
  const nutritrack_users = new Map<string, { id: string; hash: string }>();
  const sessions = new Map<string, { id: string; userId: string; expiresAt: Date; revoked: boolean }>();
  let sequence = 0;
  const query: DatabaseExecutor["query"] = async (input, values = []) => {
    const text = typeof input === "string" ? input : input.text;
    values = typeof input === "string" ? values : (input.values ?? []);
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(text)) return { rows: [] };
    if (text.startsWith("INSERT INTO nutritrack_users")) {
      const email = String(values[0]);
      if (nutritrack_users.has(email)) throw Object.assign(new Error("duplicate"), { code: "23505" });
      const id = `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
      nutritrack_users.set(email, { id, hash: String(values[1]) });
      return { rowCount: 1, rows: [{ id, email_normalized: email, password_hash: values[1] }] };
    }
    if (text.startsWith("INSERT INTO tracker_profile") || text.startsWith("INSERT INTO goals")) return { rowCount: 1, rows: [] };
    if (text.startsWith("SELECT id, email_normalized")) {
      const email = String(values[0]);
      const user = nutritrack_users.get(email);
      return { rowCount: user ? 1 : 0, rows: user ? [{ id: user.id, email_normalized: email, password_hash: user.hash }] : [] };
    }
    if (text.startsWith("INSERT INTO auth_sessions")) {
      sessions.set(String(values[2]), { id: String(values[0]), userId: String(values[1]), expiresAt: values[3] as Date, revoked: false });
      return { rowCount: 1, rows: [] };
    }
    if (text.startsWith("SELECT 1 FROM auth_sessions")) {
      const session = sessions.get(String(values[2]));
      const active = session && session.id === values[0] && session.userId === values[1] && !session.revoked && session.expiresAt > new Date();
      return { rowCount: active ? 1 : 0, rows: active ? [{ "?column?": 1 }] : [] };
    }
    if (text.startsWith("UPDATE auth_sessions")) {
      const session = sessions.get(String(values[0]));
      if (session) session.revoked = true;
      return { rowCount: session ? 1 : 0, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  };
  const app = createApp(config, { pool: databasePoolStub(query), logger: recordingLogger() });
  return { app, nutritrack_users, sessions };
}

test("signup hashes passwords, login is generic, and logout revokes the JWT session", async () => {
  const { app, nutritrack_users } = authHarness();
  const agent = request.agent(app);
  const signup = await agent.post("/api/v1/auth/signup").set("Origin", ORIGIN).send({ email: " Person@Example.com ", password: PASSWORD });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  assert.match(signup.headers["set-cookie"][0], /HttpOnly/);
  assert.equal(nutritrack_users.has("person@example.com"), true);
  assert.notEqual(nutritrack_users.get("person@example.com")?.hash, PASSWORD);

  assert.equal((await agent.get("/api/v1/auth/me")).status, 200);
  const duplicate = await request(app).post("/api/v1/auth/signup").set("Origin", ORIGIN).send({ email: "person@example.com", password: PASSWORD });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, "ACCOUNT_UNAVAILABLE");

  const bad = await request(app).post("/api/v1/auth/login").set("Origin", ORIGIN).send({ email: "person@example.com", password: "wrong-password-value" });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error.code, "INVALID_CREDENTIALS");

  assert.equal((await agent.post("/api/v1/auth/logout").set("Origin", ORIGIN)).status, 204);
  assert.equal((await agent.get("/api/v1/auth/me")).status, 401);
});

test("expired JWT sessions are rejected", async () => {
  const { app, sessions } = authHarness();
  const agent = request.agent(app);
  const signup = await agent.post("/api/v1/auth/signup").set("Origin", ORIGIN).send({
    email: "expired@example.com",
    password: PASSWORD,
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const session = [...sessions.values()][0];
  assert.ok(session);
  session.expiresAt = new Date(0);

  const response = await agent.get("/api/v1/auth/me");
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "AUTHENTICATION_REQUIRED");
});

test("CSRF origin checks and authentication run before protected AI parsing", async () => {
  let providerCalls = 0;
  const pool = databasePoolStub(async () => ({ rowCount: 0, rows: [] }));
  const app = createApp(config, {
    pool,
    logger: recordingLogger(),
    extractionService: { async extract() { providerCalls += 1; throw new Error("must not run"); } },
  });
  const csrf = await request(app).post("/api/v1/auth/login").send({ email: "person@example.com", password: PASSWORD });
  assert.equal(csrf.status, 403);
  assert.equal(csrf.body.error.code, "CSRF_ORIGIN_REJECTED");

  const unauthenticated = await request(app).post("/api/v1/nutrition/extract").set("Origin", ORIGIN);
  assert.equal(unauthenticated.status, 401);
  assert.equal(providerCalls, 0);
});
