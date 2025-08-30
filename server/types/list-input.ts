import { z } from "zod";

// Base pagination schema
export const paginationSchema = z.object({
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
});

// Sorting schema
export const sortingSchema = z.object({
  orderBy: z.string().optional(),
  orderDirection: z.enum(["asc", "desc"]).default("desc"),
});

// Search schema
export const searchSchema = z.object({
  query: z.string().optional(),
  searchFields: z.array(z.string()).optional(),
});

// Generic filters schema (key-value pairs)
export const filtersSchema = z.record(z.string(), z.any()).optional();

// Date range schema
export const dateRangeSchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .optional();

// Include and select schemas
export const includeSchema = z.array(z.string()).optional();
export const selectSchema = z.array(z.string()).optional();

// Base list input schema that combines all the above
export const baseListInputSchema = z.object({
  pagination: paginationSchema.optional().default({}),
  sorting: sortingSchema.optional().default({}),
  search: searchSchema.optional(),
  filters: filtersSchema,
  dateRange: dateRangeSchema,
  include: includeSchema,
  select: selectSchema,
});

// Type definitions
export type PaginationInput = z.infer<typeof paginationSchema>;
export type SortingInput = z.infer<typeof sortingSchema>;
export type SearchInput = z.infer<typeof searchSchema>;
export type FiltersInput = z.infer<typeof filtersSchema>;
export type DateRangeInput = z.infer<typeof dateRangeSchema>;
export type IncludeInput = z.infer<typeof includeSchema>;
export type SelectInput = z.infer<typeof selectSchema>;
export type BaseListInput = z.infer<typeof baseListInputSchema>;

// Pagination metadata type
export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// Paginated response type
export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMetadata;
}

// Helper function to create pagination metadata
export function createPaginationMetadata(
  page: number,
  limit: number,
  total: number
): PaginationMetadata {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

// Helper function to calculate offset from page and limit
export function calculateOffset(page: number, limit: number): number {
  return (page - 1) * limit;
}

// Helper function to create a paginated response
export function createPaginatedResponse<T>(
  items: T[],
  page: number,
  limit: number,
  total: number
): PaginatedResponse<T> {
  return {
    items,
    pagination: createPaginationMetadata(page, limit, total),
  };
}
