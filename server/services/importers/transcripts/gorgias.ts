/**
 * Gorgias tickets (D7-8), pulled once through the Gorgias REST API with the
 * merchant's account email and an API key. The credentials are used for this
 * import only: never stored, never logged.
 *
 * Internal notes (`public: false`) are left out; `from_agent` decides the role.
 */

import { TranscriptImportError, type TestTranscript } from "./test-transcript";

export const GORGIAS_MAX_TICKETS = 100;
const REQUEST_TIMEOUT_MS = 15_000;
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface GorgiasImportInput {
  /** "acme" for acme.gorgias.com. */
  subdomain: string;
  email: string;
  apiKey: string;
  /** Most recent tickets first, at most GORGIAS_MAX_TICKETS. */
  limit: number;
}

interface GorgiasMessage {
  from_agent?: boolean;
  public?: boolean;
  stripped_text?: string | null;
  body_text?: string | null;
  created_datetime?: string | null;
}

interface GorgiasTicket {
  id: number | string;
  subject?: string | null;
  messages?: GorgiasMessage[];
}

type Fetch = typeof fetch;

/** The subdomain from "acme", "acme.gorgias.com" or "https://acme.gorgias.com/app". */
export function normalizeGorgiasSubdomain(value: string): string {
  const subdomain = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\.gorgias\.com.*$/, "")
    .replace(/\/.*$/, "");
  if (!SUBDOMAIN.test(subdomain)) {
    throw new TranscriptImportError("Enter your Gorgias subdomain, like acme for acme.gorgias.com");
  }
  return subdomain;
}

export async function fetchGorgiasTranscripts(
  input: GorgiasImportInput,
  fetchImpl: Fetch = fetch,
): Promise<TestTranscript[]> {
  const base = `https://${normalizeGorgiasSubdomain(input.subdomain)}.gorgias.com/api`;
  const limit = Math.max(1, Math.min(input.limit, GORGIAS_MAX_TICKETS));
  const authorization = `Basic ${Buffer.from(`${input.email}:${input.apiKey}`).toString("base64")}`;

  async function get<T>(path: string): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        headers: { Authorization: authorization, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: "error",
      });
    } catch {
      throw new TranscriptImportError("Could not reach Gorgias; check the subdomain");
    }
    if (response.status === 401 || response.status === 403) {
      throw new TranscriptImportError("Gorgias refused the email and API key");
    }
    if (response.status === 429) {
      throw new TranscriptImportError("Gorgias is rate limiting requests; try again in a minute");
    }
    if (!response.ok) {
      throw new TranscriptImportError(`Gorgias answered with an error (${response.status})`);
    }
    return (await response.json()) as T;
  }

  // Ticket ids, newest first, following the cursor until the limit.
  const ticketIds: Array<number | string> = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({
      limit: String(Math.min(limit - ticketIds.length, 100)),
      order_by: "created_datetime:desc",
    });
    if (cursor) query.set("cursor", cursor);
    const page = await get<{ data?: GorgiasTicket[]; meta?: { next_cursor?: string | null } }>(
      `/tickets?${query}`,
    );
    for (const ticket of page.data ?? []) ticketIds.push(ticket.id);
    cursor = page.meta?.next_cursor ?? null;
  } while (cursor && ticketIds.length < limit);

  // One ticket at a time: Gorgias API keys get a small request budget.
  const transcripts: TestTranscript[] = [];
  for (const id of ticketIds.slice(0, limit)) {
    const ticket = await get<GorgiasTicket>(`/tickets/${encodeURIComponent(String(id))}`);
    const messages = (ticket.messages ?? [])
      .filter((m) => m.public !== false)
      .sort((a, b) => (a.created_datetime ?? "").localeCompare(b.created_datetime ?? ""));
    transcripts.push({
      externalId: String(ticket.id),
      title: ticket.subject ?? null,
      turns: messages.map((m) => ({
        role: m.from_agent ? "agent" : "customer",
        text: m.stripped_text || m.body_text || "",
        timestamp: m.created_datetime ?? null,
      })),
    });
  }
  return transcripts;
}
