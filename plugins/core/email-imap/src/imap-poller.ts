import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { HayLogger } from "@hay/plugin-sdk/types";
import { PluginApiClient } from "./plugin-api.js";

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
  mailbox: string;
  pollingIntervalMs: number;
}

export interface ImapPoller {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createImapPoller(config: ImapConfig, logger: HayLogger): ImapPoller {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let isPolling = false;
  let stopped = false;

  async function poll(): Promise<void> {
    if (isPolling || stopped) return;
    isPolling = true;

    let client: ImapFlow | null = null;

    try {
      client = new ImapFlow({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.password },
        logger: false,
      });

      await client.connect();
      const lock = await client.getMailboxLock(config.mailbox);

      try {
        // Search for unseen messages (search can return false when no matches)
        const searchResult = await client.search({ seen: false }, { uid: true });
        const uids = Array.isArray(searchResult) ? searchResult : [];

        if (uids.length === 0) {
          return;
        }

        logger.info(`Found ${uids.length} new email(s)`);

        for (const uid of uids) {
          try {
            await processMessage(client, uid, logger);
          } catch (error: any) {
            logger.error(`Failed to process email UID ${uid}: ${error.message}`);
            // Continue to next message — don't mark this one as seen
          }
        }
      } finally {
        lock.release();
      }
    } catch (error: any) {
      logger.error(`IMAP poll failed: ${error.message}`);
      // Will retry on next poll interval
    } finally {
      if (client) {
        try {
          await client.logout();
        } catch {
          /* ignore logout errors */
        }
      }
      isPolling = false;
    }
  }

  async function processMessage(client: ImapFlow, uid: number, logger: HayLogger): Promise<void> {
    // Fetch the full message source
    const download = await client.download(String(uid), undefined, { uid: true });
    const parsed = await simpleParser(download.content);

    const from = parsed.from?.value?.[0];
    if (!from?.address) {
      logger.warn(`Skipping email UID ${uid}: no From address`);
      await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      return;
    }

    const senderEmail = from.address.toLowerCase();
    const senderName = from.name || senderEmail;

    // Extract content: prefer plain text, fallback to stripped HTML
    let content = parsed.text || "";
    if (!content && parsed.html) {
      content = stripHtml(parsed.html);
    }

    if (!content) {
      logger.warn(`Skipping email UID ${uid}: empty body`);
      await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      return;
    }

    // Note attachments but skip downloading them in v1
    const attachmentNames = (parsed.attachments || []).map((a) => a.filename || "unnamed");
    if (attachmentNames.length > 0) {
      content += `\n\n[Attachments: ${attachmentNames.join(", ")}]`;
    }

    // Build email metadata for threading
    const emailMetadata = {
      subject: parsed.subject || "(no subject)",
      messageId: parsed.messageId || null,
      inReplyTo: parsed.inReplyTo || null,
      references: parsed.references || [],
      from: senderEmail,
      to: extractAddresses(parsed.to),
      date: parsed.date?.toISOString() || null,
      senderName,
      imapUid: uid,
    };

    // Send to platform via Plugin API
    const apiClient = new PluginApiClient(logger);
    const result = await apiClient.mutation<{
      messageId: string;
      conversationId: string;
      processed: boolean;
    }>("messages.receive", {
      from: senderEmail,
      content,
      channel: "email",
      metadata: emailMetadata,
    });

    logger.info("Email processed", {
      from: senderEmail,
      subject: emailMetadata.subject,
      messageId: result.messageId,
      conversationId: result.conversationId,
    });

    // Mark as seen AFTER successful processing
    await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
  }

  return {
    async start(): Promise<void> {
      stopped = false;

      // Do an initial poll immediately
      await poll();

      // Then schedule recurring polls
      intervalId = setInterval(() => {
        poll().catch((error) => {
          logger.error(`Unhandled error in IMAP poll: ${error.message}`);
        });
      }, config.pollingIntervalMs);

      logger.info(
        `IMAP polling started (every ${config.pollingIntervalMs / 1000}s on ${config.mailbox})`,
      );
    },

    async stop(): Promise<void> {
      stopped = true;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      logger.info("IMAP polling stopped");
    },
  };
}

/**
 * Basic HTML to plain text conversion for AI processing.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * Extract email addresses from a parsed address field.
 */
function extractAddresses(field: any): string[] {
  if (!field) return [];
  if (Array.isArray(field)) {
    return field.flatMap((f) => extractAddresses(f));
  }
  if (field.value && Array.isArray(field.value)) {
    return field.value.map((a: any) => a.address).filter(Boolean);
  }
  return [];
}
