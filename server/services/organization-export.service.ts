/**
 * Full merchant export (D15-6): everything an organization keeps in Hay.chat,
 * as JSON Lines plus CSV in one ZIP, built by the background job queue and
 * downloaded through a short-lived signed link.
 *
 * Inside the ZIP:
 *   conversations.jsonl / conversations.csv
 *   messages.jsonl      / messages.csv
 *   customers.jsonl     / customers.csv
 *   documents.jsonl, playbooks.jsonl, playbook_versions.jsonl, agents.jsonl,
 *   webchat_settings.jsonl, business_hours.jsonl, organization.json, README.txt
 *   attachments.jsonl + attachments/<upload id>-<name>: the chat files still stored
 *
 * Only columns a merchant would recognise are exported: processing locks,
 * encryption keys and similar internals stay out. Plugin credentials, API keys
 * and users' passwords are never exported. Chat attachment files (G1) are added
 * up to MAX_ATTACHMENT_BYTES in total; the rest are listed in attachments.jsonl
 * with the reason they were left out.
 */
import { createWriteStream, type WriteStream } from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as archiver from "archiver";
import { AppDataSource } from "@server/database/data-source";
import { Job, JobPriority, JobStatus } from "@server/entities/job.entity";
import { auditLogService } from "./audit-log.service";
import { CONVERSATION_MEDIA_FOLDER, storageService } from "./storage.service";
import { signMediaUrl } from "./media-url.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("organization-export");

export const ORGANIZATION_EXPORT_JOB_TYPE = "organization_export";
/** Private upload folder; served only through /v1/media (staff session or signed link). */
export const ORGANIZATION_EXPORT_FOLDER = "organization-exports";
/** The ZIP can be downloaded for this long, then it is deleted. */
export const EXPORT_RETENTION_DAYS = 7;
/** A download link opens the file for this long (the button mints a fresh one each time). */
export const DOWNLOAD_LINK_TTL_SECONDS = 15 * 60;
/** A job "processing" for longer than this died with its server; a new request may start. */
const STALE_PROCESSING_MS = 2 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;
const MAX_EXPORT_BYTES = 2 * 1024 * 1024 * 1024;
/** Attachment files stop being added past this total, so the ZIP stays under MAX_EXPORT_BYTES. */
export const MAX_ATTACHMENT_BYTES = 1536 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

type Row = Record<string, unknown>;

interface ExportTable {
  /** File name without extension. */
  name: string;
  /** SELECT list and FROM/WHERE; `$1` is the organization id, `$2` the keyset cursor. */
  select: string;
  from: string;
  /** Column used for keyset paging (unique, sortable). */
  key: string;
  /** Columns written to the CSV (in order); no CSV when absent. */
  csv?: string[];
}

const EXPORT_TABLES: ExportTable[] = [
  {
    name: "conversations",
    select: `c.id, c.title, c.channel, c.status, c.language, c.customer_id, c.agent_id,
      c.playbook_id, c.assigned_user_id, c.summary, c.resolution_metadata, c.metadata,
      c.created_at, c.updated_at, c.last_message_at, c.closed_at, c.ended_at,
      c.handed_off_at, c.spam_flagged_at, c.spam_reason`,
    from: `conversations c WHERE c.organization_id = $1 AND c.deleted_at IS NULL`,
    key: "c.id",
    csv: [
      "id",
      "created_at",
      "channel",
      "status",
      "title",
      "language",
      "customer_id",
      "agent_id",
      "assigned_user_id",
      "last_message_at",
      "closed_at",
      "handed_off_at",
      "summary",
    ],
  },
  {
    name: "messages",
    select: `m.id, m.conversation_id, m.created_at, m.type, m.direction, m.sender, m.content,
      m.attachments, m.status, m.delivery_state, m.detected_language, m.sentiment, m.intent,
      m.approved_by, m.approved_at, m.original_content, m.metadata`,
    from: `messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.organization_id = $1 AND c.deleted_at IS NULL`,
    key: "m.id",
    csv: ["id", "conversation_id", "created_at", "type", "sender", "content", "attachments"],
  },
  {
    name: "customers",
    select: `cu.id, cu.external_id, cu.name, cu.email, cu.phone, cu.notes, cu.external_metadata,
      cu.created_at, cu.updated_at`,
    from: `customers cu WHERE cu.organization_id = $1`,
    key: "cu.id",
    csv: ["id", "name", "email", "phone", "external_id", "notes", "created_at"],
  },
  {
    name: "documents",
    select: `d.id, d.title, d.description, d.type, d.status, d.visibility, d.tags, d.categories,
      d.content, d.source_url, d.external_url, d.import_method, d.attachments, d.metadata,
      d.created_at, d.updated_at`,
    from: `documents d WHERE d.organization_id = $1`,
    key: "d.id",
  },
  {
    name: "playbooks",
    select: `p.*`,
    from: `playbooks p WHERE p.organization_id = $1`,
    key: "p.id",
  },
  {
    name: "playbook_versions",
    select: `pv.*`,
    from: `playbook_versions pv JOIN playbooks p ON p.id = pv.playbook_id
      WHERE p.organization_id = $1`,
    key: "pv.id",
  },
  {
    name: "agents",
    select: `a.*`,
    from: `agents a WHERE a.organization_id = $1`,
    key: "a.id",
  },
  {
    name: "webchat_settings",
    select: `w.id, w.widget_title, w.widget_subtitle, w.position, w.theme, w.show_greeting,
      w.greeting_message, w.allowed_domains, w.is_enabled, w.custom_css,
      w.spam_classifier_enabled, w.spam_guidance, w.created_at, w.updated_at`,
    from: `webchat_settings w WHERE w.organization_id = $1`,
    key: "w.id",
  },
  {
    name: "business_hours",
    select: `b.*`,
    from: `business_hours_schedules b WHERE b.organization_id = $1`,
    key: "b.id",
  },
];

/* ================== CSV ================== */

/** One CSV cell: objects as JSON, quotes doubled, formula-looking values defused. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  // A spreadsheet runs cells that start with these as formulas (CSV injection).
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(row: Row, columns: string[]): string {
  return columns.map((column) => csvCell(row[column])).join(",") + "\r\n";
}

function write(stream: WriteStream, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stream.write(chunk)) resolve();
    else {
      stream.once("drain", resolve);
      stream.once("error", reject);
    }
  });
}

function close(stream: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end((error?: Error | null) => (error ? reject(error) : resolve()));
  });
}

/* ================== SERVICE ================== */

export interface OrganizationExportResult extends Record<string, unknown> {
  uploadId: string;
  fileName: string;
  bytes: number;
  counts: Record<string, number>;
  completedAt: string;
  expiresAt: string;
}

export interface OrganizationExportState {
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed" | "expired";
  requestedAt: Date;
  completedAt: string | null;
  expiresAt: string | null;
  bytes: number | null;
  counts: Record<string, number> | null;
}

export class OrganizationExportService {
  private repository() {
    return AppDataSource.getRepository(Job);
  }

  /** The organization's most recent export job, if any. */
  async latestJob(organizationId: string): Promise<Job | null> {
    return this.repository()
      .createQueryBuilder("job")
      .where("job.organizationId = :organizationId", { organizationId })
      .andWhere("job.data ->> 'type' = :type", { type: ORGANIZATION_EXPORT_JOB_TYPE })
      .orderBy("job.createdAt", "DESC")
      .getOne();
  }

  /** What the Settings → Privacy card shows. */
  async getState(
    organizationId: string,
    now = new Date(),
  ): Promise<OrganizationExportState | null> {
    const job = await this.latestJob(organizationId);
    if (!job) return null;
    const result = (job.result ?? {}) as Partial<OrganizationExportResult>;
    let status: OrganizationExportState["status"];
    switch (job.status) {
      case JobStatus.COMPLETED:
        status =
          result.expiresAt && new Date(result.expiresAt) > now && result.uploadId
            ? "completed"
            : "expired";
        break;
      case JobStatus.FAILED:
      case JobStatus.CANCELLED:
        status = "failed";
        break;
      case JobStatus.PROCESSING:
        status = this.isStale(job, now) ? "failed" : "processing";
        break;
      default:
        status = "queued";
    }
    return {
      jobId: job.id,
      status,
      requestedAt: job.createdAt,
      completedAt: result.completedAt ?? null,
      expiresAt: result.expiresAt ?? null,
      bytes: result.bytes ?? null,
      counts: result.counts ?? null,
    };
  }

  private isStale(job: Job, now: Date): boolean {
    return now.getTime() - new Date(job.updatedAt).getTime() > STALE_PROCESSING_MS;
  }

  /**
   * Queue an export. A request while one is already queued or running returns
   * that one instead of starting a second.
   */
  async request(
    organizationId: string,
    userId: string | undefined,
    now = new Date(),
  ): Promise<{ jobId: string; alreadyRunning: boolean }> {
    const latest = await this.latestJob(organizationId);
    const running =
      latest &&
      (latest.status === JobStatus.QUEUED ||
        latest.status === JobStatus.PENDING ||
        (latest.status === JobStatus.PROCESSING && !this.isStale(latest, now)));
    if (running) return { jobId: latest.id, alreadyRunning: true };

    const job = await this.repository().save(
      this.repository().create({
        title: "Organization data export",
        description: "Everything this organization keeps in Hay.chat, as JSON Lines and CSV",
        status: JobStatus.QUEUED,
        priority: JobPriority.NORMAL,
        organizationId,
        data: { type: ORGANIZATION_EXPORT_JOB_TYPE, requestedById: userId ?? null },
      }),
    );
    await auditLogService.log({
      userId,
      organizationId,
      action: "organization.export.request",
      resource: "organization",
      metadata: { jobId: job.id },
    });
    return { jobId: job.id, alreadyRunning: false };
  }

  /**
   * A fresh signed link to the latest ready export, or null when there is none
   * (never requested, still running, failed or expired). Every link is audit-logged.
   */
  async downloadLink(
    organizationId: string,
    userId: string | undefined,
    now = new Date(),
  ): Promise<{ url: string; fileName: string; expiresAt: string } | null> {
    const job = await this.latestJob(organizationId);
    const result = (job?.result ?? {}) as Partial<OrganizationExportResult>;
    if (
      !job ||
      job.status !== JobStatus.COMPLETED ||
      !result.uploadId ||
      !result.expiresAt ||
      new Date(result.expiresAt) <= now
    ) {
      return null;
    }
    await auditLogService.log({
      userId,
      organizationId,
      action: "organization.export.download",
      resource: "organization",
      metadata: { jobId: job.id, bytes: result.bytes ?? null },
    });
    return {
      url: signMediaUrl(result.uploadId, DOWNLOAD_LINK_TTL_SECONDS, now.getTime()),
      fileName: result.fileName ?? "hay-chat-export.zip",
      expiresAt: result.expiresAt,
    };
  }

  /** Run by the job queue (job-queue.service, BACKGROUND_JOB_TYPES). */
  async processJob(job: Job, now = new Date()): Promise<OrganizationExportResult> {
    const organizationId = job.organizationId;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hay-org-export-"));
    try {
      const counts: Record<string, number> = {};
      const files: string[] = [];

      for (const table of EXPORT_TABLES) {
        const written = await this.exportTable(table, organizationId, dir);
        counts[table.name] = written.count;
        files.push(...written.files);
      }

      const attachments = await this.exportAttachments(organizationId, dir);
      counts.attachments = attachments.included;
      files.push(...attachments.files);

      const organization = await this.organizationRow(organizationId);
      await fs.writeFile(
        path.join(dir, "organization.json"),
        JSON.stringify(organization, null, 2) + "\n",
      );
      files.push("organization.json");
      await fs.writeFile(path.join(dir, "README.txt"), readme(now, counts));
      files.unshift("README.txt");

      const date = now.toISOString().slice(0, 10);
      const zipPath = path.join(dir, "export.zip");
      await zipFiles(dir, files, zipPath);
      const buffer = await fs.readFile(zipPath);
      const fileName = `hay-chat-export-${date}.zip`;

      const { upload } = await storageService.upload({
        buffer,
        originalName: fileName,
        mimeType: "application/zip",
        folder: ORGANIZATION_EXPORT_FOLDER,
        organizationId,
        uploadedById: (job.data?.requestedById as string | null) ?? undefined,
        maxSize: MAX_EXPORT_BYTES,
      });

      // Keep only the newest file: an older export is replaced by this one.
      await this.deleteOlderExports(organizationId, job.id);

      logger.info({ organizationId, jobId: job.id, bytes: buffer.length, counts }, "Export ready");
      return {
        uploadId: upload.id,
        fileName,
        bytes: buffer.length,
        counts,
        completedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + EXPORT_RETENTION_DAYS * DAY_MS).toISOString(),
      };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  private async exportTable(
    table: ExportTable,
    organizationId: string,
    dir: string,
  ): Promise<{ count: number; files: string[] }> {
    const jsonl = createWriteStream(path.join(dir, `${table.name}.jsonl`));
    const csv = table.csv ? createWriteStream(path.join(dir, `${table.name}.csv`)) : null;
    if (csv && table.csv)
      await write(csv, csvLine(Object.fromEntries(table.csv.map((c) => [c, c])), table.csv));

    let count = 0;
    let cursor: string | null = null;
    try {
      for (;;) {
        const rows: Row[] = await AppDataSource.query(
          `SELECT ${table.select} FROM ${table.from}
             ${cursor ? `AND ${table.key} > $2` : ""}
           ORDER BY ${table.key} LIMIT ${PAGE_SIZE}`,
          cursor ? [organizationId, cursor] : [organizationId],
        );
        for (const row of rows) {
          await write(jsonl, JSON.stringify(row) + "\n");
          if (csv && table.csv) await write(csv, csvLine(row, table.csv));
        }
        count += rows.length;
        if (rows.length < PAGE_SIZE) break;
        cursor = String(rows[rows.length - 1].id);
      }
    } finally {
      await close(jsonl);
      if (csv) await close(csv);
    }
    return { count, files: [`${table.name}.jsonl`, ...(csv ? [`${table.name}.csv`] : [])] };
  }

  /**
   * Chat attachments (G1): the organization's conversation-media uploads that
   * belong to a kept conversation, either linked to it or referenced by one of
   * its messages (messages stored before linking existed). Each file is read
   * through storageService (S3 or local disk); a file missing from storage or
   * past the size budget is listed in attachments.jsonl with the reason.
   */
  async exportAttachments(
    organizationId: string,
    dir: string,
    maxBytes = MAX_ATTACHMENT_BYTES,
  ): Promise<{ included: number; files: string[] }> {
    const index = createWriteStream(path.join(dir, "attachments.jsonl"));
    const files = ["attachments.jsonl"];
    let included = 0;
    let totalBytes = 0;
    let cursor: string | null = null;
    try {
      for (;;) {
        const rows: Row[] = await AppDataSource.query(
          `SELECT u.id, u.original_name, u.mime_type, u.size, u.conversation_id, u.message_id,
                  u.created_at
             FROM uploads u
            WHERE u.organization_id = $1 AND u.folder = $2
              AND (
                u.conversation_id IN (
                  SELECT c.id FROM conversations c
                   WHERE c.organization_id = $1 AND c.deleted_at IS NULL)
                OR u.id::text IN (
                  SELECT a->>'id'
                    FROM messages m
                    JOIN conversations c ON c.id = m.conversation_id
                    CROSS JOIN LATERAL jsonb_array_elements(
                      CASE WHEN jsonb_typeof(m.attachments) = 'array'
                        THEN m.attachments ELSE '[]'::jsonb END) a
                   WHERE c.organization_id = $1 AND c.deleted_at IS NULL)
              )
              ${cursor ? "AND u.id > $3" : ""}
            ORDER BY u.id LIMIT ${PAGE_SIZE}`,
          cursor
            ? [organizationId, CONVERSATION_MEDIA_FOLDER, cursor]
            : [organizationId, CONVERSATION_MEDIA_FOLDER],
        );
        for (const row of rows) {
          const id = String(row.id);
          const size = Number(row.size) || 0;
          const entry: Row = { ...row, file: null, included: false, reason: null };
          if (totalBytes + size > maxBytes) {
            entry.reason = "export_size_limit";
          } else {
            try {
              const { buffer } = await storageService.download(id);
              const file = `attachments/${id}-${safeFileName(String(row.original_name ?? ""))}`;
              await fs.mkdir(path.join(dir, "attachments"), { recursive: true });
              await fs.writeFile(path.join(dir, file), buffer);
              files.push(file);
              totalBytes += buffer.length;
              included++;
              Object.assign(entry, { file, included: true });
            } catch (error) {
              logger.debug({ err: error, uploadId: id }, "Attachment not in storage");
              entry.reason = "file_not_found";
            }
          }
          await write(index, JSON.stringify(entry) + "\n");
        }
        if (rows.length < PAGE_SIZE) break;
        cursor = String(rows[rows.length - 1].id);
      }
    } finally {
      await close(index);
    }
    return { included, files };
  }

  private async organizationRow(organizationId: string): Promise<Row | null> {
    const [row] = (await AppDataSource.query(
      `SELECT id, name, slug, description, about, website, contact_email, default_language, timezone,
              date_format, time_format, settings,
              created_at
         FROM organizations WHERE id = $1`,
      [organizationId],
    )) as Row[];
    return row ?? null;
  }

  private async deleteOlderExports(organizationId: string, keepJobId: string): Promise<void> {
    const jobs = await this.repository()
      .createQueryBuilder("job")
      .where("job.organizationId = :organizationId", { organizationId })
      .andWhere("job.data ->> 'type' = :type", { type: ORGANIZATION_EXPORT_JOB_TYPE })
      .andWhere("job.status = :status", { status: JobStatus.COMPLETED })
      .andWhere("job.id != :keepJobId", { keepJobId })
      .getMany();
    for (const job of jobs) await this.deleteExportFile(job);
  }

  /** Remove the ZIP of a finished export; the job row stays as a record. */
  private async deleteExportFile(job: Job): Promise<void> {
    const result = (job.result ?? {}) as Partial<OrganizationExportResult>;
    if (!result.uploadId) return;
    try {
      await storageService.delete(result.uploadId);
    } catch (error) {
      logger.warn({ err: error, jobId: job.id }, "Could not delete an export file");
      return;
    }
    job.result = { ...result, uploadId: null };
    await this.repository().save(job);
  }

  /** Daily: delete ZIPs past their retention (scheduled-jobs.registry). */
  async cleanupExpired(now = new Date()): Promise<number> {
    const jobs = await this.repository()
      .createQueryBuilder("job")
      .where("job.data ->> 'type' = :type", { type: ORGANIZATION_EXPORT_JOB_TYPE })
      .andWhere("job.status = :status", { status: JobStatus.COMPLETED })
      .andWhere("job.result ->> 'uploadId' IS NOT NULL")
      .andWhere("(job.result ->> 'expiresAt')::timestamptz <= :now", { now })
      .getMany();
    for (const job of jobs) await this.deleteExportFile(job);
    return jobs.length;
  }
}

/** A file name safe inside a ZIP on any OS. */
function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, 80);
  return cleaned || "file";
}

function zipFiles(dir: string, files: string[], zipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver.default("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    for (const file of files) archive.file(path.join(dir, file), { name: file });
    void archive.finalize();
  });
}

export function readme(generatedAt: Date, counts: Record<string, number>): string {
  const lines = [
    "Hay.chat data export",
    `Generated: ${generatedAt.toISOString()}`,
    "",
    "Everything your organization keeps in Hay.chat. Each .jsonl file has one JSON",
    "object per line; the .csv files hold the main columns for spreadsheets.",
    "Times are UTC. Ids link the files together (messages.conversation_id,",
    "conversations.customer_id, conversations.agent_id, playbook_versions.playbook_id).",
    "",
    "Files:",
    ...EXPORT_TABLES.map(
      (table) =>
        `  ${table.name}.jsonl${table.csv ? ` and ${table.name}.csv` : ""}: ${counts[table.name] ?? 0} rows`,
    ),
    "  organization.json: your organization's name and settings",
    `  attachments/: ${counts.attachments ?? 0} files sent in your conversations`,
    "  attachments.jsonl: every chat file, the conversation and message it belongs",
    "    to, and its path in attachments/ (or why it was left out: the file was",
    "    already deleted, or the export reached its size limit)",
    "",
    "Not included: plugin credentials, API keys and passwords.",
    "",
  ];
  return lines.join("\n");
}

export const organizationExportService = new OrganizationExportService();
