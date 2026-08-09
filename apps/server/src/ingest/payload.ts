import { z } from "zod";

export const webhookAlertSchema = z.object({
  status: z.enum(["firing", "resolved"]),
  labels: z.record(z.string(), z.string()).default({}),
  annotations: z.record(z.string(), z.string()).default({}),
  startsAt: z.string(),
  endsAt: z.string().default(""),
  generatorURL: z.string().default(""),
  fingerprint: z.string(),
});

export const webhookPayloadSchema = z.object({
  version: z.string().optional(),
  groupKey: z.string().optional(),
  status: z.string().optional(),
  receiver: z.string().optional(),
  groupLabels: z.record(z.string(), z.string()).optional(),
  commonLabels: z.record(z.string(), z.string()).optional(),
  commonAnnotations: z.record(z.string(), z.string()).optional(),
  externalURL: z.string().optional(),
  alerts: z.array(webhookAlertSchema),
});

export type WebhookAlert = z.infer<typeof webhookAlertSchema>;
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

/** Alertmanager sends Go's zero-value sentinel for an EndsAt that hasn't happened yet. */
export function isZeroTimestamp(iso: string): boolean {
  return iso === "" || iso === "0001-01-01T00:00:00Z";
}
