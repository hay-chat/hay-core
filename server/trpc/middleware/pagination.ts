import { t } from "../init";
import type { BaseListInput } from "../../types/list-input";
import {
  createPaginatedResponse,
  calculateOffset,
} from "../../types/list-input";
import { TRPCError } from "@trpc/server";

// Middleware to parse and validate pagination input
export const withPagination = t.middleware(async ({ next, input }) => {
  try {
    // Parse the input as BaseListInput
    const parsedInput = input as BaseListInput;

    // Extract pagination parameters with defaults
    const pagination = parsedInput.pagination || {};
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;

    // Validate pagination parameters
    if (page < 1) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Page must be greater than 0",
      });
    }

    if (limit < 1 || limit > 100) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Limit must be between 1 and 100",
      });
    }

    // Calculate offset
    const offset = calculateOffset(page, limit);

    // Extract other parameters
    const sorting = parsedInput.sorting || {};
    const search = parsedInput.search;
    const filters = parsedInput.filters;
    const dateRange = parsedInput.dateRange;
    const include = parsedInput.include;
    const select = parsedInput.select;

    // Pass processed parameters to the next middleware/procedure
    return next({
      ctx: {
        listParams: {
          pagination: { page, limit, offset },
          sorting: {
            orderBy: sorting.orderBy || "created_at",
            orderDirection: sorting.orderDirection || "desc",
          },
          search,
          filters,
          dateRange,
          include,
          select,
        },
      },
    });
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }

    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid pagination parameters",
      cause: error,
    });
  }
});

// Helper type for list parameters passed through middleware
export interface ListParams {
  pagination: {
    page: number;
    limit: number;
    offset: number;
  };
  sorting: {
    orderBy?: string;
    orderDirection: "asc" | "desc";
  };
  search?: {
    query?: string;
    searchFields?: string[];
  };
  filters?: Record<string, any>;
  dateRange?: {
    from?: string;
    to?: string;
  };
  include?: string[];
  select?: string[];
}

// Helper function to create paginated response from middleware context
export function createPaginatedResponseFromContext<T>(
  items: T[],
  total: number,
  listParams: ListParams
): ReturnType<typeof createPaginatedResponse<T>> {
  return createPaginatedResponse(
    items,
    listParams.pagination.page,
    listParams.pagination.limit,
    total
  );
}
