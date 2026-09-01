import * as client from "openid-client";
import type { FastifyInstance } from "fastify";
import type { AuthMe } from "@hermano/shared";
import { SESSION_COOKIE_NAME } from "../../auth/constants.js";
import { readSessionCookie } from "../../auth/cookie.js";
import { consumePendingAuth, createPendingAuth, getOidcClient } from "../../auth/oidc.js";
import { createSession, deleteSession, ensureLocalOwner, upsertOidcUser } from "../../auth/session.js";
import type { Config } from "../../config.js";
import type { DbClient } from "../../db/client.js";
import type { UserRow } from "../../db/schema.js";

function toPublicUser(user: UserRow) {
  return { id: user.id, name: user.name, email: user.email };
}

export function registerAuthRoutes(app: FastifyInstance, db: DbClient, config: Config): void {
  app.get("/api/auth/me", async (request): Promise<AuthMe> => {
    if (!config.oidc) {
      return { authenticated: true, user: toPublicUser(ensureLocalOwner(db)), oidcEnabled: false };
    }
    return {
      authenticated: request.user != null,
      user: request.user ? toPublicUser(request.user) : null,
      oidcEnabled: true,
    };
  });

  if (!config.oidc) return;
  const oidcConfig = config.oidc;

  app.get("/auth/login", async (request, reply) => {
    let oidc: client.Configuration;
    try {
      oidc = getOidcClient();
    } catch (err) {
      request.log.error(err, "OIDC login attempted before discovery completed");
      return reply.code(503).send({ error: "login temporarily unavailable" });
    }
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();
    createPendingAuth(state, codeVerifier, nonce);

    const authUrl = client.buildAuthorizationUrl(oidc, {
      redirect_uri: oidcConfig.redirectUrl,
      scope: "openid profile email",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
    });

    return reply.redirect(authUrl.toString());
  });

  app.get<{ Querystring: { state?: string } }>("/auth/callback", async (request, reply) => {
    const stateParam = request.query.state;
    const pending = stateParam ? consumePendingAuth(stateParam) : null;
    if (!pending) {
      return reply.code(400).send({ error: "invalid or expired login attempt" });
    }

    try {
      const oidc = getOidcClient();
      const currentUrl = new URL(request.url, oidcConfig.redirectUrl);
      const tokens = await client.authorizationCodeGrant(oidc, currentUrl, {
        pkceCodeVerifier: pending.codeVerifier,
        expectedState: stateParam,
        expectedNonce: pending.nonce,
      });

      const claims = tokens.claims();
      if (!claims?.sub) {
        throw new Error("ID token missing sub claim");
      }

      const user = upsertOidcUser(db, {
        sub: claims.sub,
        email: typeof claims.email === "string" ? claims.email : undefined,
        name: typeof claims.name === "string" ? claims.name : undefined,
      });

      const session = createSession(db, user.id);
      reply.setCookie(SESSION_COOKIE_NAME, session.id, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: request.protocol === "https",
        expires: session.expiresAt,
        signed: true,
      });

      return reply.redirect("/");
    } catch (err) {
      request.log.error(err, "OIDC callback failed");
      return reply.code(400).send({ error: "login failed" });
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    const sessionId = readSessionCookie(request);
    if (sessionId) {
      deleteSession(db, sessionId);
      reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    }
    return reply.code(204).send();
  });
}
