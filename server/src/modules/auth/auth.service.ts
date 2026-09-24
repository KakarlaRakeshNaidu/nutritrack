import { createHash, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import type { Response } from "express";

import type { AppConfig } from "../../config/env.js";
import { mapDatabaseError } from "../../db/database-errors.js";
import { withTransaction } from "../../db/transaction.js";
import type { DatabasePool, Logger } from "../../types.js";
import { AppError } from "../../utils/errors.js";
import type { Credentials } from "./auth.schemas.js";
import { findActiveSession, findLoginUser, insertSession, insertUser, revokeSession } from "./auth.repository.js";
import { createAccountMailer, type AccountMailer } from "./mailer.js";
import { hashPassword, verifyPassword } from "./password.js";

export const SESSION_COOKIE = "nutritrack_session";
export interface AuthIdentity { userId: string; email: string; sessionId: string }

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
function unauthorized(): AppError {
  return new AppError({ status: 401, code: "AUTHENTICATION_REQUIRED", message: "Please sign in to continue." });
}
function cookieValue(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export interface AuthService {
  signup(credentials: Credentials): Promise<{ user: { id: string; email: string }; token: string; expiresAt: Date }>;
  login(credentials: Credentials): Promise<{ user: { id: string; email: string }; token: string; expiresAt: Date }>;
  authenticate(cookieHeader: string | undefined): Promise<AuthIdentity>;
  logout(cookieHeader: string | undefined): Promise<void>;
  setCookie(response: Response, token: string, expiresAt: Date): void;
  clearCookie(response: Response): void;
}

export function createAuthService({ pool, config, logger = console, mailer = createAccountMailer(config.mail, logger) }: {
  pool: DatabasePool; config: Pick<AppConfig, "JWT_SECRET" | "NODE_ENV" | "SESSION_TTL_HOURS" | "mail">; logger?: Logger; mailer?: AccountMailer;
}): AuthService {
  const cookieOptions = {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: (config.NODE_ENV === "production" ? "none" : "lax") as "none" | "lax",
    path: "/api/v1",
  };

  async function issue(user: { id: string; email: string }) {
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 60 * 60 * 1000);
    const token = jwt.sign({ email: user.email }, config.JWT_SECRET, {
      algorithm: "HS256", subject: user.id, jwtid: sessionId,
      issuer: "nutritrack", audience: "nutritrack-client",
      expiresIn: config.SESSION_TTL_HOURS * 60 * 60,
    });
    await insertSession(pool, { id: sessionId, userId: user.id, tokenHash: tokenHash(token), expiresAt });
    return { user, token, expiresAt };
  }

  return {
    async signup(credentials) {
      const passwordHash = await hashPassword(credentials.password);
      let user;
      try {
        user = await withTransaction(pool, (client) => insertUser(client, credentials.email, passwordHash));
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "23505") {
          throw new AppError({ status: 409, code: "ACCOUNT_UNAVAILABLE", message: "An account could not be created with those credentials." });
        }
        throw mapDatabaseError(error);
      }
      const result = await issue({ id: user.id, email: user.email });
      void mailer.sendWelcome(user.email);
      return result;
    },
    async login(credentials) {
      let user;
      try { user = await findLoginUser(pool, credentials.email); } catch (error) { throw mapDatabaseError(error); }
      const valid = user ? await verifyPassword(credentials.password, user.passwordHash) : await verifyPassword(credentials.password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
      if (!user || !valid) throw new AppError({ status: 401, code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." });
      return issue({ id: user.id, email: user.email });
    },
    async authenticate(cookieHeader) {
      const token = cookieValue(cookieHeader);
      if (!token) throw unauthorized();
      try {
        const payload = jwt.verify(token, config.JWT_SECRET, {
          algorithms: ["HS256"], issuer: "nutritrack", audience: "nutritrack-client",
        });
        if (typeof payload === "string" || typeof payload.sub !== "string" || typeof payload.jti !== "string" || typeof payload.email !== "string") throw unauthorized();
        const active = await findActiveSession(pool, { id: payload.jti, userId: payload.sub, tokenHash: tokenHash(token) });
        if (!active) throw unauthorized();
        return { userId: payload.sub, email: payload.email, sessionId: payload.jti };
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw unauthorized();
      }
    },
    async logout(cookieHeader) {
      const token = cookieValue(cookieHeader);
      if (token) await revokeSession(pool, tokenHash(token));
    },
    setCookie(response, token, expiresAt) { response.cookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt }); },
    clearCookie(response) { response.clearCookie(SESSION_COOKIE, cookieOptions); },
  };
}
