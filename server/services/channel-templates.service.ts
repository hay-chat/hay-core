/**
 * Channel templates (D13-3)
 *
 * Some channels only accept pre-approved message templates once their reply
 * window has closed (WhatsApp's 24-hour customer service window). Core stays
 * channel-agnostic: the conversation's channel plugin lists the templates it
 * can send through `GET /templates` on its worker, and a template send is an
 * ordinary human-agent message whose metadata carries `channelTemplate`. The
 * normal delivery path (`channel-delivery.service`, POST /deliver, retries,
 * failure marking) then hands it to the plugin, which sends the template.
 *
 * Worker contract — `GET /templates` → 200 `{ templates: ChannelTemplate[] }`
 * listing only templates that can be sent right now; 404 = the channel has no
 * templates.
 */

import { z } from "zod";
import { createLogger } from "@server/lib/logger";
import { pluginManagerService } from "./plugin-manager.service";
import { workerFetch } from "@server/lib/worker-client";

const logger = createLogger("channel-templates");

const TEMPLATES_TIMEOUT_MS = 10_000;

const channelTemplateSchema = z.object({
  name: z.string().min(1).max(512),
  language: z.string().min(1).max(20),
  category: z.string().max(64).optional(),
  /** Body text with `{{variable}}` placeholders. */
  body: z.string().max(4096),
  /** Placeholder names in send order (`"1"`, `"2"` or named ones). */
  variables: z.array(z.string().min(1).max(64)).max(20),
});

const templatesResponseSchema = z.object({ templates: z.array(channelTemplateSchema).max(500) });

export type ChannelTemplate = z.infer<typeof channelTemplateSchema>;

/** What a template message stores in `message.metadata.channelTemplate`. */
export interface ChannelTemplateSend {
  name: string;
  language: string;
  parameters: Array<{ name: string; value: string }>;
}

export interface ChannelTemplateList {
  /** False when the channel (or its plugin) has no templates at all. */
  supported: boolean;
  templates: ChannelTemplate[];
}

/** Fill `{{name}}` placeholders; unknown ones are left as they are. */
export function renderTemplateBody(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name: string) =>
    name in values ? values[name] : match,
  );
}

/** Templates the conversation's channel plugin can send now. */
export async function listChannelTemplates(
  organizationId: string,
  channel: string,
): Promise<ChannelTemplateList> {
  if (channel === "web") {
    return { supported: false, templates: [] };
  }
  const pluginId = await pluginManagerService.findPluginIdByChannel(organizationId, channel);
  if (!pluginId) {
    return { supported: false, templates: [] };
  }

  const worker = await pluginManagerService.getOrStartWorker(organizationId, pluginId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEMPLATES_TIMEOUT_MS);
  try {
    const response = await workerFetch(worker.port, "/templates", {
      method: "GET",
      signal: controller.signal,
    });
    if (response.status === 404) {
      return { supported: false, templates: [] };
    }
    if (!response.ok) {
      throw new Error(`Channel plugin answered ${response.status}`);
    }
    const parsed = templatesResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      logger.warn({ pluginId, issues: parsed.error.issues.slice(0, 3) }, "Invalid /templates body");
      throw new Error("Channel plugin returned an invalid template list");
    }
    return { supported: true, templates: parsed.data.templates };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Validate a template send against the plugin's current list and build what
 * the message stores: the rendered text (shown in Hay.chat) and the
 * `channelTemplate` metadata the plugin sends from.
 */
export async function prepareChannelTemplate(args: {
  organizationId: string;
  channel: string;
  name: string;
  language: string;
  values: Record<string, string>;
}): Promise<
  | { content: string; channelTemplate: ChannelTemplateSend }
  | { error: "template_not_found" | "missing_variables" }
> {
  const { templates } = await listChannelTemplates(args.organizationId, args.channel);
  const template = templates.find((t) => t.name === args.name && t.language === args.language);
  if (!template) {
    return { error: "template_not_found" };
  }
  const parameters = template.variables.map((name) => ({
    name,
    value: (args.values[name] ?? "").trim(),
  }));
  if (parameters.some((parameter) => !parameter.value)) {
    return { error: "missing_variables" };
  }
  const filled = Object.fromEntries(parameters.map((p) => [p.name, p.value]));
  return {
    content: renderTemplateBody(template.body, filled),
    channelTemplate: { name: template.name, language: template.language, parameters },
  };
}
