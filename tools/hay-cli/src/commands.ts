/**
 * Command implementations. Each returns `{ data, text }`: `data` is printed for
 * --json, `text` (lines) otherwise.
 */
import { HayApi, HayApiError, type Credentials } from "./api";
import {
  boolFlag,
  intFlag,
  isUuid,
  parseDuration,
  stringFlag,
  UsageError,
  type ParsedArgs,
} from "./args";
import { loadConfig, resolveProfile, updateProfile, type TargetProfile } from "./config";
import {
  formatConversationHeader,
  formatMessage,
  normalizeMessage,
  repliesAfter,
  sortMessages,
  type Msg,
} from "./format";
import { fetchLogs, formatEntry, type LogEntry } from "./logs";
import { WebchatClient } from "./webchat";

export interface CommandResult {
  data: unknown;
  text: string[];
  exitCode?: number;
}

export interface Ctx {
  args: ParsedArgs;
  target: string;
  profile: TargetProfile;
  api: HayApi;
  verbose: boolean;
}

export function buildCtx(args: ParsedArgs, target: string): Ctx {
  let profile = resolveProfile(target, loadConfig());
  const credentials = envCredentials();
  // A saved session of another user is dropped so the .env account takes over.
  if (credentials && profile.email && profile.email !== credentials.email) {
    profile = {
      ...profile,
      email: undefined,
      accessToken: undefined,
      refreshToken: undefined,
      organizationId: undefined,
      organizationName: undefined,
    };
  }
  const orgOverride = stringFlag(args, "org");
  const api = new HayApi({
    profile,
    organizationId: orgOverride ?? profile.organizationId,
    credentials,
    onTokens: (tokens) => updateProfile(target, tokens),
    onLogin: (email, response, organizationId) =>
      updateProfile(target, {
        email,
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        organizationId,
        organizationName: response.user.organizations.find((o) => o.id === organizationId)?.name,
      }),
  });
  return { args, target, profile, api, verbose: boolFlag(args, "verbose") };
}

/** HAY_EMAIL + HAY_PASSWORD (tools/hay-cli/.env or the environment) enable automatic login. */
function envCredentials(): Credentials | undefined {
  const email = process.env.HAY_EMAIL;
  const password = process.env.HAY_PASSWORD;
  return email && password ? { email, password } : undefined;
}

// ---------------------------------------------------------------- auth / orgs

interface MeOrganization {
  id: string;
  name: string;
  slug: string;
  role: string;
  suspendedAt: string | null;
  aiPausedAt: string | null;
}

interface Me {
  id: string;
  email: string;
  authMethod: string;
  organizations: MeOrganization[];
  activeOrganizationId?: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

export async function login(ctx: Ctx): Promise<CommandResult> {
  const email = stringFlag(ctx.args, "email") ?? process.env.HAY_EMAIL ?? ctx.profile.email;
  if (!email)
    throw new UsageError("hay login --email <email> (password from HAY_PASSWORD or stdin)");
  const password = process.env.HAY_PASSWORD || (await readStdin());
  if (!password) throw new UsageError("No password: set HAY_PASSWORD or pipe it on stdin");

  const result = await ctx.api.login(email, password);
  const organizationId =
    stringFlag(ctx.args, "org") ?? ctx.profile.organizationId ?? result.user.activeOrganizationId;
  const org = result.user.organizations.find((o) => o.id === organizationId);
  return {
    data: { target: ctx.target, email, organizationId },
    text: [
      `logged in to ${ctx.target} as ${email}; org ${org?.name ?? "-"} (${organizationId ?? "-"})`,
    ],
  };
}

export async function logout(ctx: Ctx): Promise<CommandResult> {
  if (ctx.profile.refreshToken) {
    await ctx.api
      .mutation("auth.logout", { refreshToken: ctx.profile.refreshToken }, { auth: false })
      .catch(() => undefined);
  }
  updateProfile(ctx.target, { accessToken: undefined, refreshToken: undefined });
  return { data: { target: ctx.target, loggedOut: true }, text: [`logged out of ${ctx.target}`] };
}

async function me(ctx: Ctx): Promise<Me> {
  return ctx.api.query<Me>("auth.me");
}

export async function whoami(ctx: Ctx): Promise<CommandResult> {
  const user = await me(ctx);
  const orgId = stringFlag(ctx.args, "org") ?? ctx.profile.organizationId;
  const org = user.organizations.find((o) => o.id === orgId);
  return {
    data: { target: ctx.target, baseUrl: ctx.profile.baseUrl, user, organizationId: orgId },
    text: [
      `${ctx.target} ${ctx.profile.baseUrl}`,
      `user ${user.email} (${user.id}) via ${user.authMethod}`,
      `org ${org ? `${org.name} (${org.id}) role=${org.role}` : (orgId ?? "none, run `hay use <org>`")}`,
    ],
  };
}

export async function orgs(ctx: Ctx): Promise<CommandResult> {
  const user = await me(ctx);
  const current = stringFlag(ctx.args, "org") ?? ctx.profile.organizationId;
  return {
    data: user.organizations.map((o) => ({ ...o, current: o.id === current })),
    text: user.organizations.map(
      (o) =>
        `${o.id === current ? "*" : " "} ${o.id}  ${o.slug}  ${o.name}  role=${o.role}` +
        `${o.suspendedAt ? " SUSPENDED" : ""}${o.aiPausedAt ? " AI-PAUSED" : ""}`,
    ),
  };
}

export async function use(ctx: Ctx): Promise<CommandResult> {
  const query = ctx.args.positionals[1];
  if (!query) throw new UsageError("hay use <org id | slug | name>");
  const user = await me(ctx);
  const needle = query.toLowerCase();
  const matches = user.organizations.filter(
    (o) => o.id === query || o.slug.toLowerCase() === needle || o.name.toLowerCase() === needle,
  );
  const fuzzy =
    matches.length > 0
      ? matches
      : user.organizations.filter((o) => o.name.toLowerCase().includes(needle));
  if (fuzzy.length !== 1) {
    const names = (fuzzy.length ? fuzzy : user.organizations).map((o) => `${o.slug} (${o.name})`);
    throw new UsageError(
      `${fuzzy.length ? "Ambiguous" : "No"} org match for "${query}": ${names.join(", ")}`,
    );
  }
  const org = fuzzy[0];
  updateProfile(ctx.target, { organizationId: org.id, organizationName: org.name });
  return { data: org, text: [`using ${org.name} (${org.id}) on ${ctx.target}`] };
}

// ---------------------------------------------------------------- logs

async function logsFor(
  ctx: Ctx,
  conversationId: string | undefined,
  sinceMs: number,
): Promise<{ entries: LogEntry[]; note?: string }> {
  const source = ctx.profile.logSource;
  if (!source) {
    return {
      entries: [],
      note:
        ctx.target === "local"
          ? "no local log source: run the dev server with `| tee <file>` and set HAY_LOCAL_LOG_FILE"
          : `no logSource configured for target ${ctx.target}`,
    };
  }
  const limit = intFlag(ctx.args, "log-limit", 300);
  return { entries: await fetchLogs(source, { conversationId, sinceMs, limit }) };
}

function renderLogs(entries: LogEntry[], conversationId: string | undefined, verbose: boolean) {
  // Both ids are implied by a conversation filter; printing them on every line is noise.
  const omit = conversationId ? ["conversationId", "organizationId"] : [];
  return entries.map((e) => formatEntry(e, { omit, verbose }));
}

const logData = (entries: LogEntry[]) =>
  entries.map((e) =>
    e.fields
      ? { time: e.time, level: e.level, module: e.module, msg: e.msg, ...e.fields }
      : { raw: e.raw },
  );

export async function logs(ctx: Ctx): Promise<CommandResult> {
  const conversationId = ctx.args.positionals[1];
  if (conversationId && !isUuid(conversationId)) {
    throw new UsageError("hay logs [<conversationId>] [--since 15m] [--log-limit 300]");
  }
  const since = stringFlag(ctx.args, "since");
  // A conversation filter looks back further by default: its first turn may be hours old.
  const sinceMs = Date.now() - parseDuration(since ?? (conversationId ? "24h" : "15m"));
  const { entries, note } = await logsFor(ctx, conversationId, sinceMs);
  return {
    data: { conversationId, since: new Date(sinceMs).toISOString(), note, lines: logData(entries) },
    text: note
      ? [note]
      : [...renderLogs(entries, conversationId, ctx.verbose), `(${entries.length} lines)`],
  };
}

// ---------------------------------------------------------------- conversations

async function authedMessages(ctx: Ctx, conversationId: string, limit: number): Promise<Msg[]> {
  const raw = await ctx.api.query<Array<Record<string, unknown>>>("conversations.getMessages", {
    conversationId,
    limit,
  });
  return sortMessages(raw.map(normalizeMessage));
}

export async function convShow(ctx: Ctx): Promise<CommandResult> {
  const id = ctx.args.positionals[2];
  if (!id || !isUuid(id))
    throw new UsageError("hay conv show <conversationId> [--limit 200] [--logs]");
  const [conversation, messages] = await Promise.all([
    ctx.api.query<Record<string, unknown>>("conversations.get", { id }),
    authedMessages(ctx, id, intFlag(ctx.args, "limit", 200)),
  ]);
  const text = [
    ...formatConversationHeader(conversation, { verbose: ctx.verbose }),
    "",
    ...messages.map((m) => formatMessage(m, { verbose: ctx.verbose })),
  ];
  let logLines: LogEntry[] | undefined;
  if (boolFlag(ctx.args, "logs")) {
    const created = String(conversation.created_at ?? conversation.createdAt ?? "");
    const sinceMs = created ? new Date(created).getTime() - 5_000 : Date.now() - 86_400_000;
    const result = await logsFor(ctx, id, sinceMs);
    logLines = result.entries;
    text.push(
      "",
      "--- logs",
      ...(result.note ? [result.note] : renderLogs(result.entries, id, ctx.verbose)),
    );
  }
  return {
    data: { conversation, messages, logs: logLines ? logData(logLines) : undefined },
    text,
  };
}

export async function convList(ctx: Ctx): Promise<CommandResult> {
  const status = stringFlag(ctx.args, "status");
  const result = await ctx.api.query<{
    items: Array<Record<string, unknown>>;
    pagination: { total?: number; page?: number; totalPages?: number };
  }>("conversations.list", {
    pagination: {
      page: intFlag(ctx.args, "page", 1),
      limit: Math.min(intFlag(ctx.args, "limit", 20), 100),
    },
    ...(status ? { filters: { status } } : {}),
  });
  return {
    data: result,
    text: [
      ...result.items.map(
        (c) =>
          `${String(c.id)}  ${String(c.status).padEnd(15)} ${String(c.channel ?? "-").padEnd(9)}` +
          ` ${String(c.updated_at ?? c.updatedAt ?? "").slice(0, 16)}  ${String(c.title ?? "")}`,
      ),
      `(${result.items.length} of ${result.pagination?.total ?? "?"})`,
    ],
  };
}

// ---------------------------------------------------------------- chat

const POLL_MS = 1500;

export async function chatSend(ctx: Ctx): Promise<CommandResult> {
  const content = ctx.args.positionals.slice(2).join(" ").trim();
  if (!content) {
    throw new UsageError(
      'hay chat send "<message>" [--conversation <id>] [--no-wait] [--timeout 90s] [--logs] [--lang en] [--org <id>]',
    );
  }
  const organizationId = stringFlag(ctx.args, "org") ?? ctx.profile.organizationId;
  const webchat = new WebchatClient(ctx.api, ctx.target);
  const startedMs = Date.now() - 2_000;

  let conversationId = stringFlag(ctx.args, "conversation");
  const isNew = !conversationId;
  if (!conversationId) {
    if (!organizationId)
      throw new UsageError("No organization: run `hay use <org>` or pass --org <id>");
    conversationId = await webchat.createConversation(organizationId, stringFlag(ctx.args, "lang"));
  }

  const { messageId } = await webchat.sendMessage(conversationId, content);
  const header = `conversation ${conversationId}${isNew ? " (new)" : ""}  message ${messageId}`;

  if (boolFlag(ctx.args, "no-wait")) {
    return { data: { conversationId, messageId, waited: false }, text: [header] };
  }

  // Wait for an answer to our message, then one more poll for trailing messages.
  const deadline = Date.now() + parseDuration(stringFlag(ctx.args, "timeout") ?? "90s");
  let state = await webchat.getMessages(conversationId);
  let replies = repliesAfter(state.messages, messageId);
  let settled = false;
  while (Date.now() < deadline) {
    if (replies.length > 0 && !state.typing) {
      if (settled) break;
      settled = true;
    } else {
      settled = false;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    state = await webchat.getMessages(conversationId);
    replies = repliesAfter(state.messages, messageId);
  }
  const timedOut = replies.length === 0;

  // Logged in to the same org: show the full turn (tools, documents, confidence).
  let turn: Msg[] = replies;
  let detail = false;
  if (ctx.api.hasAuth && organizationId) {
    try {
      const all = await authedMessages(ctx, conversationId, 200);
      const ours = all.findIndex((m) => m.id === messageId);
      if (ours !== -1) {
        turn = all.slice(ours + 1);
        detail = true;
      }
    } catch (error) {
      if (!(error instanceof HayApiError)) throw error;
    }
  }

  const text = [
    header,
    ...turn.map((m) => formatMessage(m, { verbose: ctx.verbose })),
    `status=${state.status}${timedOut ? " NO REPLY before timeout" : ""}${detail ? "" : " (public view: log in for tools/docs)"}`,
  ];

  let logLines: LogEntry[] | undefined;
  if (boolFlag(ctx.args, "logs")) {
    const result = await logsFor(ctx, conversationId, startedMs);
    logLines = result.entries;
    text.push(
      "--- logs",
      ...(result.note ? [result.note] : renderLogs(result.entries, conversationId, ctx.verbose)),
    );
  }

  return {
    data: {
      conversationId,
      messageId,
      status: state.status,
      timedOut,
      replies,
      turn: detail ? turn : undefined,
      logs: logLines ? logData(logLines) : undefined,
    },
    text,
    exitCode: timedOut ? 2 : 0,
  };
}

// ---------------------------------------------------------------- plugins

interface PluginSummary {
  id: string;
  name: string;
  version: string;
  type: string[] | string;
  enabled: boolean;
  status: string;
}

async function listPlugins(ctx: Ctx): Promise<PluginSummary[]> {
  return ctx.api.query<PluginSummary[]>("plugins.getAll");
}

/** Match a user-typed plugin name against the org's plugin list; ids are never hardcoded. */
export function resolvePluginId(
  plugins: Array<{ id: string; name: string }>,
  query: string,
): string {
  const needle = query.toLowerCase();
  const exact = plugins.find((p) => p.id.toLowerCase() === needle);
  if (exact) return exact.id;
  const candidates = plugins.filter(
    (p) =>
      p.name.toLowerCase() === needle ||
      p.id.toLowerCase().endsWith(`-${needle}`) ||
      p.id.toLowerCase().endsWith(`/${needle}`),
  );
  if (candidates.length === 1) return candidates[0].id;
  const loose = plugins.filter(
    (p) => p.id.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle),
  );
  if (candidates.length === 0 && loose.length === 1) return loose[0].id;
  const shown = (candidates.length ? candidates : loose).map((p) => p.id);
  throw new UsageError(
    shown.length
      ? `Ambiguous plugin "${query}": ${shown.join(", ")}`
      : `No plugin matches "${query}" (see \`hay plugins list\`)`,
  );
}

export async function pluginsList(ctx: Ctx): Promise<CommandResult> {
  const plugins = await listPlugins(ctx);
  const shown = boolFlag(ctx.args, "all") ? plugins : plugins.filter((p) => p.enabled);
  shown.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.id.localeCompare(b.id));
  return {
    data: shown,
    text: [
      ...shown.map(
        (p) =>
          `${p.enabled ? "on " : "off"} ${p.id}  ${p.name} v${p.version}` +
          `  type=${[p.type].flat().join(",")}${p.status && p.status !== "available" ? ` status=${p.status}` : ""}`,
      ),
      `(${shown.length} ${boolFlag(ctx.args, "all") ? "plugins" : "enabled; --all for every plugin"})`,
    ],
  };
}

export async function pluginsTest(ctx: Ctx): Promise<CommandResult> {
  const query = ctx.args.positionals[2];
  if (!query) throw new UsageError("hay plugins test <plugin>");
  const pluginId = resolvePluginId(await listPlugins(ctx), query);
  const result = await ctx.api.query<Record<string, unknown>>("plugins.testConnection", {
    pluginId,
  });
  const { success, status, message, ...rest } = result;
  const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
  const lines = [
    `${pluginId}: ${success === false ? "FAIL" : "ok"} ${String(status ?? "")} ${String(message ?? "")}${extra}`,
  ];
  return { data: { pluginId, ...result }, text: lines, exitCode: result.success === false ? 2 : 0 };
}

export async function pluginsTools(ctx: Ctx): Promise<CommandResult> {
  const query = ctx.args.positionals[2];
  const tools =
    await ctx.api.query<
      Array<{ name: string; label?: string; description?: string; pluginId: string }>
    >("plugins.getMCPTools");
  const pluginId = query ? resolvePluginId(await listPlugins(ctx), query) : undefined;
  const shown = pluginId ? tools.filter((t) => t.pluginId === pluginId) : tools;
  return {
    data: shown,
    text: [
      ...shown.map(
        (t) => `${t.pluginId}  ${t.name}  ${(t.description ?? "").split("\n")[0].slice(0, 100)}`,
      ),
      `(${shown.length} tools)`,
    ],
  };
}

export async function pluginsCall(_ctx: Ctx): Promise<CommandResult> {
  throw new UsageError(
    "plugins call is not available: the server has no endpoint that runs a plugin tool outside a " +
      "conversation. Drive the tool through `hay chat send` and read it back with `hay conv show`.",
  );
}
