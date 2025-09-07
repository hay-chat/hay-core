# Global Pagination System

This document describes the global pagination system implemented for all list endpoints in the tRPC server.

## Overview

The pagination system provides a consistent, flexible, and type-safe way to handle listing operations across all entities. It supports:

- **Pagination**: Page-based navigation with configurable limits
- **Sorting**: Flexible ordering by any field
- **Search**: Full-text search across specified fields
- **Filtering**: Generic and entity-specific filters
- **Date Range**: Filter by creation/update dates
- **Includes**: Load related entities
- **Select**: Return only specific fields

## Architecture

### Core Components

1. **Base Types** (`server/types/list-input.ts`)

   - Generic pagination schemas and types
   - Helper functions for creating responses

2. **Entity-Specific Schemas** (`server/types/entity-list-inputs.ts`)

   - Customized input schemas for each entity type
   - Entity-specific filters and search fields

3. **Pagination Middleware** (`server/trpc/middleware/pagination.ts`)

   - Validates and processes pagination input
   - Adds parsed parameters to tRPC context

4. **Base Repository** (`server/repositories/base.repository.ts`)

   - Generic pagination query building
   - Extensible filter and search methods

5. **List Procedure Factory** (`server/trpc/procedures/list.ts`)
   - Creates standardized list procedures
   - Reduces boilerplate code

## Usage

### Basic Example

```typescript
// Simple pagination
const result = await trpc.v1.documents.list.query({
  pagination: { page: 1, limit: 20 },
});
```

### Advanced Example

```typescript
// Complex pagination with all options
const result = await trpc.v1.documents.list.query({
  pagination: { page: 2, limit: 10 },
  sorting: { orderBy: "created_at", orderDirection: "desc" },
  search: {
    query: "customer support",
    searchFields: ["title", "content"],
  },
  filters: {
    type: "ARTICLE",
    status: "PUBLISHED",
  },
  dateRange: {
    from: "2024-01-01T00:00:00Z",
    to: "2024-12-31T23:59:59Z",
  },
  include: ["organization"],
  select: ["id", "title", "created_at"],
});
```

### Response Format

All list endpoints return a consistent response structure:

```typescript
{
  items: T[],           // Array of entities
  pagination: {
    page: number,       // Current page number
    limit: number,      // Items per page
    total: number,      // Total items available
    totalPages: number, // Total pages available
    hasNext: boolean,   // Whether next page exists
    hasPrev: boolean    // Whether previous page exists
  }
}
```

## Input Schema Structure

### Pagination

```typescript
{
  pagination?: {
    page?: number,      // Default: 1, Min: 1
    limit?: number      // Default: 20, Min: 1, Max: 100
  }
}
```

### Sorting

```typescript
{
  sorting?: {
    orderBy?: string,           // Entity-specific field names
    orderDirection?: "asc" | "desc"  // Default: "desc"
  }
}
```

### Search

```typescript
{
  search?: {
    query?: string,           // Search term
    searchFields?: string[]   // Fields to search in
  }
}
```

### Filters

```typescript
{
  filters?: {
    [key: string]: any    // Generic filters
    // Plus entity-specific filters
  }
}
```

### Date Range

```typescript
{
  dateRange?: {
    from?: string,    // ISO datetime string
    to?: string       // ISO datetime string
  }
}
```

### Includes & Select

```typescript
{
  include?: string[],   // Relations to load
  select?: string[]     // Specific fields to return
}
```

## Entity-Specific Features

### Documents

**Available Filters:**

- `type`: DocumentationType enum
- `status`: DocumentationStatus enum
- `visibility`: DocumentVisibility enum
- `agentId`: UUID string
- `playbookId`: UUID string

**Search Fields:** `["title", "content"]`

**Sort Fields:** `["created_at", "updated_at", "title", "type", "status"]`

### Conversations

**Available Filters:**

- `status`: Conversation status enum
- `agentId`: UUID string
- `playbookId`: UUID string
- `hasMessages`: Boolean

**Search Fields:** `["title"]`

**Sort Fields:** `["created_at", "updated_at", "title", "status"]`

### Agents

**Available Filters:**

- `enabled`: Boolean
- `hasPlaybooks`: Boolean

**Search Fields:** `["name", "description"]`

**Sort Fields:** `["created_at", "updated_at", "name", "enabled"]`

### Playbooks

**Available Filters:**

- `status`: Playbook status enum
- `agentIds`: Array of UUID strings

**Search Fields:** `["name", "description", "prompt_template"]`

**Sort Fields:** `["created_at", "updated_at", "name", "status"]`

## Implementation Guide

### Adding Pagination to New Entities

1. **Create Entity Schema** (in `entity-list-inputs.ts`):

```typescript
export const myEntityListInputSchema = baseListInputSchema.extend({
  filters: myEntityFiltersSchema,
  sorting: z
    .object({
      orderBy: z.enum(["created_at", "name", "status"]).default("created_at"),
      orderDirection: z.enum(["asc", "desc"]).default("desc"),
    })
    .optional()
    .default({}),
});
```

2. **Extend BaseRepository**:

```typescript
export class MyEntityRepository extends BaseRepository<MyEntity> {
  constructor() {
    super(MyEntity);
  }

  protected applyFilters(queryBuilder, filters, organizationId) {
    // Add entity-specific filter logic
  }
}
```

3. **Create List Procedure**:

```typescript
export const myEntityRouter = t.router({
  list: createListProcedure(myEntityListInputSchema, myEntityRepository),
  // ... other procedures
});
```

### Customizing Behavior

Override methods in your repository for custom behavior:

```typescript
export class CustomRepository extends BaseRepository<MyEntity> {
  protected applyFilters(queryBuilder, filters, organizationId) {
    // Custom filter logic
    if (filters?.customFilter) {
      queryBuilder.andWhere("entity.custom_field = :custom", {
        custom: filters.customFilter,
      });
    }
    super.applyFilters(queryBuilder, filters, organizationId);
  }

  protected applySearch(queryBuilder, search) {
    // Custom search logic
    if (search?.query) {
      queryBuilder.andWhere(
        "to_tsvector('english', entity.searchable_content) @@ plainto_tsquery(:query)",
        { query: search.query }
      );
    }
  }
}
```

## Performance Considerations

1. **Database Indexes**: Ensure proper indexes on commonly sorted/filtered fields
2. **Limit Constraints**: Maximum limit is enforced at 100 items per page
3. **Query Optimization**: The system uses TypeORM query builders for efficient queries
4. **Count Queries**: Total count is calculated before applying pagination

## Error Handling

The system provides clear error messages for:

- Invalid page numbers (< 1)
- Invalid limits (< 1 or > 100)
- Invalid date formats
- Unknown sort fields
- Invalid filter values

## Testing

See `server/tests/pagination.test.example.ts` for comprehensive test examples covering all pagination features.

## Migration from Legacy Endpoints

To migrate existing list endpoints:

1. Replace manual pagination logic with `createListProcedure`
2. Update input schemas to use entity-specific list input schemas
3. Remove custom pagination response building
4. Update client-side code to use new response structure

The system maintains backward compatibility where possible, but the new consistent structure provides better type safety and feature completeness.
