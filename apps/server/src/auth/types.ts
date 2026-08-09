import type { UserRow } from "../db/schema.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the auth guard hook: the local owner (single-user mode) or the session's OIDC user. Undefined on an unauthenticated request to an exempt route. */
    user?: UserRow;
  }
}
