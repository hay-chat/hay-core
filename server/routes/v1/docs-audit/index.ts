import { t, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { jobRepository } from "@server/repositories/job.repository";
import { JobStatus, JobPriority } from "@server/entities/job.entity";
import { docsAuditService } from "@server/services/docs-audit.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("docs-audit");

export const docsAuditRouter = t.router({
  /**
   * Start a documentation quality audit for the current organization.
   * Creates a job and runs the analysis in the background.
   */
  analyze: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.READ).mutation(async ({ ctx }) => {
    const organizationId = ctx.organizationId!;

    // Create a job to track the audit
    const job = await jobRepository.create({
      title: "Documentation Quality Audit",
      description: "Analyzing documentation across multiple quality dimensions",
      status: JobStatus.PROCESSING,
      priority: JobPriority.NORMAL,
      organizationId,
      data: { type: "docs_audit", stage: "starting" },
    });

    // Run audit in background
    docsAuditService.runAudit(organizationId, job.id).catch((error) => {
      logger.error({ jobId: job.id, organizationId, error }, "Background audit failed");
    });

    return {
      jobId: job.id,
      message: "Documentation audit started. Poll getResult for progress.",
    };
  }),

  /**
   * Get the status/results of a documentation audit job.
   */
  getResult: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.READ)
    .input(
      z.object({
        jobId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const job = await jobRepository.findById(input.jobId);

      if (!job || job.organizationId !== organizationId) {
        throw new Error("Audit job not found");
      }

      return {
        id: job.id,
        status: job.status,
        data: job.data,
        result: job.result,
      };
    }),
});
