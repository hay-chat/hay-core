/**
 * Pasted transcripts (D7-8), for tools with no export (Shopify Inbox):
 *
 *   Customer: Hi, where is my order?
 *   Agent: Can you send the order number?
 *   Customer: #1001
 *   ---
 *   Customer: Do you ship to Lisbon?
 *
 * A line of three or more dashes (or two blank lines) starts a new
 * conversation. A line without a "Role:" prefix continues the turn above.
 */

import { roleFromLabel, TranscriptImportError, type TestTranscript } from "./test-transcript";

const PREFIX = /^\s*([\p{L}\- ]{2,20})\s*:\s?(.*)$/u;

export function parsePastedTranscripts(content: string): TestTranscript[] {
  const blocks = content
    .replace(/\r\n/g, "\n")
    .split(/\n\s*-{3,}\s*\n|\n\s*\n\s*\n/);

  const transcripts: TestTranscript[] = [];
  blocks.forEach((block, blockIndex) => {
    const transcript: TestTranscript = { turns: [] };
    for (const line of block.split("\n")) {
      if (/^\s*-{3,}\s*$/.test(line)) continue;
      const match = PREFIX.exec(line);
      const role = match ? roleFromLabel(match[1]) : null;
      if (match && role) {
        transcript.turns.push({ role, text: match[2] });
        continue;
      }
      const current = transcript.turns[transcript.turns.length - 1];
      if (current) {
        current.text += `\n${line}`;
      } else if (line.trim()) {
        throw new TranscriptImportError(
          `Conversation ${blockIndex + 1}: start each message with "Customer:" or "Agent:"`,
        );
      }
    }
    if (transcript.turns.length > 0) transcripts.push(transcript);
  });
  return transcripts;
}
