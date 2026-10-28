import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { t, scopedProcedure } from "@server/trpc";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import {
  TRANSCRIPT_FILE_FORMATS,
  TranscriptImportError,
  type TestTranscript,
} from "@server/services/importers/transcripts";
import {
  fetchGorgiasTranscripts,
  GORGIAS_MAX_TICKETS,
} from "@server/services/importers/transcripts/gorgias";
import { testTranscriptService } from "@server/services/test-transcript.service";

/**
 * Imported past conversations (D7-8), the raw material for replays and test
 * cases. Formats are parsed on the server; nothing about the source tool is
 * stored besides its name and the conversation's id there.
 */

/** 5 MB of text: well past a few thousand conversations. */
const MAX_IMPORT_CHARS = 5_000_000;

const fileFormats = Object.keys(TRANSCRIPT_FILE_FORMATS) as [
  keyof typeof TRANSCRIPT_FILE_FORMATS,
  ...(keyof typeof TRANSCRIPT_FILE_FORMATS)[],
];

async function store(
  ctx: { organizationId: string | null; user?: { id?: string } | null },
  source: string,
  parse: () => Promise<TestTranscript[]> | TestTranscript[],
) {
  try {
    return await testTranscriptService.importTranscripts({
      organizationId: ctx.organizationId!,
      source,
      transcripts: await parse(),
      createdById: ctx.user?.id ?? null,
    });
  } catch (error) {
    if (error instanceof TranscriptImportError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}

export const testTranscriptsRouter = t.router({
  /** Import a file's text (CSV, export) or pasted conversations. */
  importText: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.UPDATE)
    .input(
      z.object({
        format: z.enum(fileFormats),
        content: z.string().min(1).max(MAX_IMPORT_CHARS),
        businessName: z.string().trim().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      store(ctx, input.format, () =>
        TRANSCRIPT_FILE_FORMATS[input.format](input.content, { businessName: input.businessName }),
      ),
    ),

  /**
   * Pull the most recent Gorgias tickets. The email and API key are used for
   * this call only; they are not stored.
   */
  importGorgias: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.UPDATE)
    .input(
      z.object({
        subdomain: z.string().trim().min(1).max(255),
        email: z.string().trim().email().max(255),
        apiKey: z.string().trim().min(1).max(500),
        limit: z.number().int().min(1).max(GORGIAS_MAX_TICKETS).default(50),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      store(ctx, "gorgias", () => fetchGorgiasTranscripts(input)),
    ),

  list: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.READ)
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
          importBatchId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) =>
      testTranscriptService.list(ctx.organizationId!, {
        limit: input?.limit ?? 50,
        offset: input?.offset ?? 0,
        importBatchId: input?.importBatchId,
      }),
    ),

  get: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.READ)
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const transcript = await testTranscriptService.get(ctx.organizationId!, input.id);
      if (!transcript) throw new TRPCError({ code: "NOT_FOUND", message: "Transcript not found" });
      return transcript;
    }),

  delete: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.UPDATE)
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(1000) }))
    .mutation(async ({ ctx, input }) => ({
      deleted: await testTranscriptService.remove(ctx.organizationId!, input.ids),
    })),
});
