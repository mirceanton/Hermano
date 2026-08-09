import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

const SPA_FALLBACK_EXEMPT_PREFIXES = ["/api/", "/auth/", "/healthz"];

/**
 * Serves the built web SPA (apps/web/dist) at `/`, with a client-side-
 * routing fallback: any unmatched GET that isn't an API/auth/health route
 * gets index.html instead of a 404, so refreshing e.g. /alerts/3 works.
 * Only registered when STATIC_WEB_DIR is set (production/Docker) — dev
 * relies on the Vite dev server instead.
 */
export function registerStaticSpa(app: FastifyInstance, staticWebDir: string): void {
  app.register(fastifyStatic, {
    root: staticWebDir,
    wildcard: false,
  });

  app.setNotFoundHandler((request, reply) => {
    const isExempt = SPA_FALLBACK_EXEMPT_PREFIXES.some((prefix) => request.url.startsWith(prefix));
    if (isExempt || request.method !== "GET") {
      return reply.code(404).send({ error: "not found" });
    }
    return reply.sendFile("index.html", staticWebDir);
  });
}
