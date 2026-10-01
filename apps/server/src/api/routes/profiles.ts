import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HermesProfile } from "@hermano/shared";
import type { DbClient } from "../../db/client.js";
import type { HermesProfileRow } from "../../db/schema.js";
import {
  createProfile,
  deleteProfile,
  getProfile,
  listProfiles,
  profileNameExists,
  ruleNamesUsingProfile,
  updateProfile,
} from "../../profiles/queries.js";

function toApiProfile(row: HermesProfileRow): HermesProfile {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    apiKeySet: Boolean(row.apiKey),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

const nameSchema = z.string().trim().min(1, "name is required").max(64, "name must be at most 64 characters");
const urlSchema = z
  .string()
  .trim()
  .url("url must be a valid URL")
  .refine((v) => /^https?:\/\//i.test(v), "url must be an http(s) URL");
// "" (or whitespace-only) clears the key, same convention as the Settings page's secret fields.
const apiKeySchema = z
  .string()
  .transform((v) => v.trim())
  .transform((v) => (v === "" ? null : v))
  .nullable();

const createBodySchema = z.object({ name: nameSchema, url: urlSchema, apiKey: apiKeySchema.optional() });
const updateBodySchema = z.object({ name: nameSchema.optional(), url: urlSchema.optional(), apiKey: apiKeySchema.optional() });

export function registerProfileRoutes(app: FastifyInstance, db: DbClient): void {
  app.get("/api/profiles", async (): Promise<HermesProfile[]> => listProfiles(db).map(toApiProfile));

  app.post("/api/profiles", async (request, reply) => {
    const parsed = createBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid profile payload" });
      return;
    }
    const { name, url, apiKey } = parsed.data;
    if (profileNameExists(db, name)) {
      reply.code(409).send({ error: "a profile with this name already exists" });
      return;
    }

    const profile = createProfile(db, { name, url, apiKey: apiKey ?? null });
    reply.code(201);
    return toApiProfile(profile) satisfies HermesProfile;
  });

  app.patch<{ Params: { id: string } }>("/api/profiles/:id", async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10);
    const parsed = updateBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid profile payload" });
      return;
    }
    const patch = parsed.data;
    if (patch.name !== undefined && profileNameExists(db, patch.name, id)) {
      reply.code(409).send({ error: "a profile with this name already exists" });
      return;
    }

    // Omitted fields are undefined here, which drizzle's .set() skips — so they stay as they are.
    const updated = updateProfile(db, id, patch);
    if (!updated) {
      reply.code(404).send({ error: "profile not found" });
      return;
    }
    return toApiProfile(updated) satisfies HermesProfile;
  });

  app.delete<{ Params: { id: string } }>("/api/profiles/:id", async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10);
    if (!getProfile(db, id)) {
      reply.code(404).send({ error: "profile not found" });
      return;
    }

    // Refuse rather than silently rerouting those rules' alerts to a different bot.
    const rules = ruleNamesUsingProfile(db, id);
    if (rules.length > 0) {
      reply.code(409).send({ error: `profile is still used by rule${rules.length > 1 ? "s" : ""}: ${rules.join(", ")}` });
      return;
    }

    deleteProfile(db, id);
    reply.code(204).send();
  });
}
