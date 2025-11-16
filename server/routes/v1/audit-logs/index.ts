import { t, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { auditLogService } from "@server/services/audit-log.service";
import type { AuditAction } from "@server/entities/audit-log.entity";
import { TRPCError } from "@trpc/server";
import { RESOURCES, ACTIONS } from "@server/types/scopes";

const exportAuditLogsSchema = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
  filters: z
    .object({
      action: z.string().optional() as z.ZodType<AuditAction | undefined>,
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
      userId: z.string().uuid().optional(),
    })
    .optional(),
});

const listAuditLogsSchema = z.object({
  pagination: z
    .object({
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(50),
    })
    .default({ page: 1, limit: 50 }),
  filters: z
    .object({
      action: z.string().optional() as z.ZodType<AuditAction | undefined>,
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
      userId: z.string().uuid().optional(),
    })
    .optional(),
});

/**
 * Convert audit logs to CSV format
 */
function convertToCSV(logs: any[]): string {
  if (logs.length === 0) {
    return "No audit logs found";
  }

  // CSV headers
  const headers = [
    "ID",
    "Created At",
    "User ID",
    "User Email",
    "Organization ID",
    "Action",
    "Resource",
    "Status",
    "Changes",
    "Metadata",
    "IP Address",
    "User Agent",
    "Error Message",
  ];

  // Convert logs to CSV rows
  const rows = logs.map((log) => {
    return [
      log.id,
      log.createdAt,
      log.userId,
      log.user?.email || "",
      log.organizationId || "",
      log.action,
      log.resource || "",
      log.status || "",
      JSON.stringify(log.changes || {}),
      JSON.stringify(log.metadata || {}),
      log.ipAddress || "",
      log.userAgent || "",
      log.errorMessage || "",
    ];
  });

  // Combine headers and rows
  const csvContent = [
    headers.join(","),
    ...rows.map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");

  return csvContent;
}

export const auditLogsRouter = t.router({
  /**
   * List audit logs with pagination and filtering
   * Requires AUDIT_LOGS:READ permission (owner/admin)
   */
  list: scopedProcedure(RESOURCES.AUDIT_LOGS, ACTIONS.READ)
    .input(listAuditLogsSchema)
    .query(async ({ ctx, input }) => {
      const { pagination, filters } = input;

      const { logs, total } = await auditLogService.getLogs({
        organizationId: ctx.organizationId!,
        action: filters?.action,
        startDate: filters?.startDate ? new Date(filters.startDate) : undefined,
        endDate: filters?.endDate ? new Date(filters.endDate) : undefined,
        userId: filters?.userId,
        limit: pagination.limit,
        offset: (pagination.page - 1) * pagination.limit,
      });

      return {
        items: logs,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          totalPages: Math.ceil(total / pagination.limit),
          hasNext: pagination.page < Math.ceil(total / pagination.limit),
          hasPrev: pagination.page > 1,
        },
      };
    }),

  /**
   * Export audit logs as CSV or JSON
   * Requires AUDIT_LOGS:EXPORT permission (owner only)
   */
  export: scopedProcedure(RESOURCES.AUDIT_LOGS, ACTIONS.EXPORT)
    .input(exportAuditLogsSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { format, filters } = input;

        // Get audit logs with filters
        const { logs } = await auditLogService.getLogs({
          organizationId: ctx.organizationId!,
          action: filters?.action,
          startDate: filters?.startDate ? new Date(filters.startDate) : undefined,
          endDate: filters?.endDate ? new Date(filters.endDate) : undefined,
          userId: filters?.userId,
        });

        if (format === "csv") {
          const csv = convertToCSV(logs);
          return {
            format: "csv" as const,
            data: csv,
            filename: `audit-logs-${new Date().toISOString()}.csv`,
          };
        } else {
          // JSON format
          return {
            format: "json" as const,
            data: JSON.stringify(logs, null, 2),
            filename: `audit-logs-${new Date().toISOString()}.json`,
          };
        }
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to export audit logs",
        });
      }
    }),
});
