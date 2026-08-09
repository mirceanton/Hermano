import type { FastifyInstance } from "fastify";
import type { DelegationRule, LabelMap } from "@hermano/shared";
import type { DbClient } from "../../db/client.js";
import type { DelegationRuleRow } from "../../db/schema.js";
import { createRule, deleteRule, listRules, ruleMatchersExist, updateRule } from "../../rules/queries.js";

function toApiRule(row: DelegationRuleRow): DelegationRule {
  return {
    id: row.id,
    name: row.name,
    matchers: row.matchers,
    enabled: row.enabled,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export function registerRuleRoutes(app: FastifyInstance, db: DbClient): void {
  app.get("/api/rules", async (): Promise<DelegationRule[]> => listRules(db).map(toApiRule));

  app.post<{ Body: { name?: string; matchers?: LabelMap; enabled?: boolean } }>("/api/rules", async (request, reply) => {
    const { name, matchers, enabled } = request.body ?? {};
    if (!name?.trim()) {
      reply.code(400).send({ error: "name is required" });
      return;
    }
    if (!matchers || Object.keys(matchers).length === 0) {
      reply.code(400).send({ error: "at least one matcher is required" });
      return;
    }
    if (ruleMatchersExist(db, matchers)) {
      reply.code(409).send({ error: "a rule with these exact matchers already exists" });
      return;
    }

    const rule = createRule(db, { name: name.trim(), matchers, enabled: enabled ?? true });
    reply.code(201);
    return toApiRule(rule) satisfies DelegationRule;
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; matchers?: LabelMap; enabled?: boolean } }>(
    "/api/rules/:id",
    async (request, reply) => {
      const id = Number.parseInt(request.params.id, 10);
      const { name, matchers, enabled } = request.body ?? {};

      if (matchers && Object.keys(matchers).length > 0 && ruleMatchersExist(db, matchers, id)) {
        reply.code(409).send({ error: "a rule with these exact matchers already exists" });
        return;
      }

      const updated = updateRule(db, id, { name: name?.trim(), matchers, enabled });
      if (!updated) {
        reply.code(404).send({ error: "rule not found" });
        return;
      }
      return toApiRule(updated) satisfies DelegationRule;
    },
  );

  app.delete<{ Params: { id: string } }>("/api/rules/:id", async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10);
    deleteRule(db, id);
    reply.code(204).send();
  });
}
