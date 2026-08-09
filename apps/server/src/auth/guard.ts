import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { DbClient } from "../db/client.js";
import { readSessionCookie } from "./cookie.js";
import { ensureLocalOwner, getUserBySession } from "./session.js";

// Alertmanager can never hold a session cookie or perform the OIDC dance,
// so /api/webhook must never be session-gated regardless of OIDC mode —
// its own, separate, optional auth is the shared-secret bearer check
// inside the webhook route handler itself. /api/auth/me is exempt so the
// frontend can always ask "am I logged in?" without hitting the gate.
const EXEMPT_API_PREFIXES = ["/api/auth/me", "/api/webhook"];

/**
 * Resolves request.user for every request. In single-user mode (no OIDC
 * configured) every request is the synthetic local owner and nothing is
 * ever rejected — this is what keeps the rest of the app oblivious to
 * which auth mode it's running in. In OIDC mode, unauthenticated requests
 * to protected /api/* routes get a 401.
 */
export function registerAuthGuard(app: FastifyInstance, db: DbClient, config: Config): void {
  if (!config.oidc) {
    const localOwner = ensureLocalOwner(db);
    app.addHook("onRequest", async (request) => {
      request.user = localOwner;
    });
    return;
  }

  app.addHook("onRequest", async (request, reply) => {
    const sessionId = readSessionCookie(request);
    const user = sessionId ? getUserBySession(db, sessionId) : null;
    if (user) {
      request.user = user;
    }

    const isProtectedApiRoute =
      request.url.startsWith("/api/") && !EXEMPT_API_PREFIXES.some((prefix) => request.url.startsWith(prefix));
    if (isProtectedApiRoute && !request.user) {
      return reply.code(401).send({ error: "authentication required" });
    }
  });
}
