import type { FastifyRequest } from "fastify";
import { SESSION_COOKIE_NAME } from "./constants.js";

/** Reads and verifies the signed session cookie, returning the session id or null if absent/tampered. */
export function readSessionCookie(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE_NAME];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid ? unsigned.value : null;
}
