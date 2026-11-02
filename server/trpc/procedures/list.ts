import { z } from "zod";
import { scopedProcedure } from "../index";
import { ACTIONS, type Resource } from "../../types/scopes";
import { withPagination } from "../middleware/pagination";
import { BaseRepository } from "../../repositories/base.repository";
import type { ObjectLiteral } from "typeorm";

/**
 * Creates a standardized list procedure for any entity
 *
 * @param resource - The resource whose read scope the caller needs
 * @param inputSchema - The Zod schema for input validation (entity-specific)
 * @param repository - The repository instance for the entity
 * @param options - Additional options for customizing the procedure
 */
export function createListProcedure<
  TEntity extends ObjectLiteral,
  TInput extends Record<string, unknown>,
>(
  resource: Resource,
  inputSchema: z.ZodType<TInput>,
  repository: BaseRepository<TEntity>,
  options?: {
    baseWhere?: (
      ctx: { organizationId?: string | null; user?: unknown; listParams?: unknown },
      input: TInput,
    ) => Record<string, unknown>;
    transform?: <T>(items: TEntity[]) => T[];
  },
) {
  return scopedProcedure(resource, ACTIONS.READ)
    .input(inputSchema)
    .use(withPagination)
    .query(async ({ ctx, input }) => {
      // Get base where conditions if provided
      const baseWhere = options?.baseWhere ? options.baseWhere(ctx, input as TInput) : undefined;

      // Execute paginated query
      const result = await repository.paginateQuery(
        ctx.listParams!,
        ctx.organizationId!,
        baseWhere,
      );

      // Transform items if transformer is provided
      if (options?.transform) {
        result.items = options.transform(result.items) as TEntity[];
      }

      return result;
    });
}
