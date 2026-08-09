import type { FastifyInstance } from "fastify";

export function registerHealthRoute(app: FastifyInstance): void {
  app.get("/healthz", async () => ({ status: "ok" }));
}
