/**
 * TestTranscript (D7-8): the neutral shape every transcript importer produces
 * (CSV, paste, WhatsApp export, Tidio, Gorgias...), and what replays and test
 * cases read. Roles are from the shop's side: "customer" is the shopper,
 * "agent" is whoever answered (a person or another bot).
 */

export type TranscriptRole = "customer" | "agent";

export interface TestTranscriptTurn {
  role: TranscriptRole;
  text: string;
  /** ISO 8601 when the source has one. */
  timestamp?: string | null;
}

export interface TestTranscript {
  /** The conversation's id in the source tool, when it has one. */
  externalId?: string | null;
  title?: string | null;
  /** An order number the conversation is about, when the source says. */
  orderRef?: string | null;
  turns: TestTranscriptTurn[];
}

/** A transcript format error, with a message fit to show the person importing. */
export class TranscriptImportError extends Error {}

export const TRANSCRIPT_LIMITS = {
  maxTranscriptsPerImport: 1000,
  maxTurnsPerTranscript: 500,
  maxTurnTextLength: 10_000,
} as const;

const CUSTOMER_ALIASES = [
  "customer",
  "shopper",
  "client",
  "visitor",
  "user",
  "contact",
  "end-user",
  "requester",
  "cliente",
  "visitante",
  "usuário",
  "usuario",
  "comprador",
];
const AGENT_ALIASES = [
  "agent",
  "support",
  "staff",
  "operator",
  "assistant",
  "bot",
  "store",
  "shop",
  "team",
  "admin",
  "atendente",
  "agente",
  "suporte",
  "equipe",
  "loja",
  "operador",
  "assistente",
];

/** "Customer", "visitor", "Atendente"... to a role, or null when unknown. */
export function roleFromLabel(label: string): TranscriptRole | null {
  const value = label.trim().toLowerCase();
  if (CUSTOMER_ALIASES.includes(value)) return "customer";
  if (AGENT_ALIASES.includes(value)) return "agent";
  return null;
}

/** An ISO timestamp, or null when the value does not parse. */
export function toIsoTimestamp(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Clean a parsed transcript: trim and drop empty turns, join consecutive
 * turns of the same role (a shopper sending three messages in a row is one
 * turn to answer), and enforce the limits. Returns null when nothing is left.
 */
export function normalizeTranscript(transcript: TestTranscript): TestTranscript | null {
  const turns: TestTranscriptTurn[] = [];
  for (const turn of transcript.turns) {
    const text = turn.text.replace(/\r\n/g, "\n").trim();
    if (!text) continue;
    const previous = turns[turns.length - 1];
    if (previous && previous.role === turn.role) {
      previous.text = `${previous.text}\n${text}`;
      continue;
    }
    turns.push({ role: turn.role, text, timestamp: turn.timestamp ?? null });
  }
  if (turns.length === 0) return null;
  if (turns.length > TRANSCRIPT_LIMITS.maxTurnsPerTranscript) {
    throw new TranscriptImportError(
      `A conversation has more than ${TRANSCRIPT_LIMITS.maxTurnsPerTranscript} turns`,
    );
  }
  for (const turn of turns) {
    if (turn.text.length > TRANSCRIPT_LIMITS.maxTurnTextLength) {
      turn.text = turn.text.slice(0, TRANSCRIPT_LIMITS.maxTurnTextLength);
    }
  }
  return {
    externalId: transcript.externalId?.trim() || null,
    title: transcript.title?.trim() || null,
    orderRef: transcript.orderRef?.trim() || null,
    turns,
  };
}

/** Normalize every transcript, drop empty ones, and check the import size. */
export function normalizeTranscripts(transcripts: TestTranscript[]): TestTranscript[] {
  const normalized = transcripts
    .map(normalizeTranscript)
    .filter((t): t is TestTranscript => t !== null);
  if (normalized.length === 0) {
    throw new TranscriptImportError("No conversations found");
  }
  if (normalized.length > TRANSCRIPT_LIMITS.maxTranscriptsPerImport) {
    throw new TranscriptImportError(
      `One import takes at most ${TRANSCRIPT_LIMITS.maxTranscriptsPerImport} conversations`,
    );
  }
  return normalized;
}
