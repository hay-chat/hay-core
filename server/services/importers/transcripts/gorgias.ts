/**
 * Gorgias tickets (D7-8), pulled once through the Gorgias REST API with the
 * merchant's account email and an API key. The credentials are used for this
 * import only: never stored, never logged.
 *
 * Internal notes (`public: false`) are left out; `from_agent` decides the role.
 *
 * An import can take a while (one request per ticket, Gorgias rate limits API
 * keys), so it runs in the background (test-transcript.service) and reads the
 * tickets as a stream, waiting out 429s.
 */

import { TranscriptImportError, TRANSCRIPT_LIMITS, type TestTranscript } from "./test-transcript";

/** Same ceiling as any other import. */
export const GORGIAS_MAX_TICKETS = TRANSCRIPT_LIMITS.maxTranscriptsPerImport;
const REQUEST_TIMEOUT_MS = 15_000;
/** 429s waited out per request before giving up; each waits Retry-After (capped). */
const RATE_LIMIT_RETRIES = 5;
const RATE_LIMIT_DEFAULT_WAIT_MS = 20_000;
const RATE_LIMIT_MAX_WAIT_MS = 60_000;
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface GorgiasImportInput {
  /** "acme" for acme.gorgias.com. */
  subdomain: string;
  email: string;
  apiKey: string;
  /** Most recent tickets first, at most GORGIAS_MAX_TICKETS (the default). */
  limit?: number;
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
type Sleep = (ms: number) => Promise<void>;
const sleepFor: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get("retry-after"));
  if (!Number.isFinite(seconds) || seconds <= 0) return RATE_LIMIT_DEFAULT_WAIT_MS;
  return Math.min(seconds * 1000, RATE_LIMIT_MAX_WAIT_MS);
}

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

/** The most recent tickets as transcripts, newest first, one at a time. */
export async function* gorgiasTranscripts(
  input: GorgiasImportInput,
  fetchImpl: Fetch = fetch,
  sleep: Sleep = sleepFor,
): AsyncGenerator<TestTranscript> {
  const base = `https://${normalizeGorgiasSubdomain(input.subdomain)}.gorgias.com/api`;
  const limit = Math.max(1, Math.min(input.limit ?? GORGIAS_MAX_TICKETS, GORGIAS_MAX_TICKETS));
  const authorization = `Basic ${Buffer.from(`${input.email}:${input.apiKey}`).toString("base64")}`;

  async function get<T>(path: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
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
        if (attempt >= RATE_LIMIT_RETRIES) {
          throw new TranscriptImportError("Gorgias kept rate limiting requests; try again later");
        }
        await sleep(retryAfterMs(response));
        continue;
      }
      if (!response.ok) {
        throw new TranscriptImportError(`Gorgias answered with an error (${response.status})`);
      }
      return (await response.json()) as T;
    }
  }

  // One page of ticket ids at a time, newest first, following the cursor until the limit.
  let read = 0;
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({
      limit: String(Math.min(limit - read, 100)),
      order_by: "created_datetime:desc",
    });
    if (cursor) query.set("cursor", cursor);
    const page = await get<{ data?: GorgiasTicket[]; meta?: { next_cursor?: string | null } }>(
      `/tickets?${query}`,
    );
    // One ticket at a time: Gorgias API keys get a small request budget.
    for (const { id } of page.data ?? []) {
      if (read >= limit) return;
      read++;
      const ticket = await get<GorgiasTicket>(`/tickets/${encodeURIComponent(String(id))}`);
      const messages = (ticket.messages ?? [])
        .filter((m) => m.public !== false)
        .sort((a, b) => (a.created_datetime ?? "").localeCompare(b.created_datetime ?? ""));
      yield {
        externalId: String(ticket.id),
        title: ticket.subject ?? null,
        turns: messages.map((m) => ({
          role: m.from_agent ? "agent" : "customer",
          text: m.stripped_text || m.body_text || "",
          timestamp: m.created_datetime ?? null,
        })),
      };
    }
    cursor = page.meta?.next_cursor ?? null;
  } while (cursor && read < limit);
}

/** Every transcript of `gorgiasTranscripts`, collected. */
export async function fetchGorgiasTranscripts(
  input: GorgiasImportInput,
  fetchImpl: Fetch = fetch,
  sleep: Sleep = sleepFor,
): Promise<TestTranscript[]> {
  const transcripts: TestTranscript[] = [];
  for await (const transcript of gorgiasTranscripts(input, fetchImpl, sleep)) {
    transcripts.push(transcript);
  }
  return transcripts;
}
