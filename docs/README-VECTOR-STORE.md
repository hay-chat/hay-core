# Vector Store Implementation Guide

## ✅ Implementation Complete

This implementation provides pgvector support with multi-tenant vector storage and similarity search for your TypeORM + Supabase Postgres application.

This document describes the pgvector and LangChain integration for embedding storage and similarity search.

## Setup

### 1. Environment Variables

Add the following to your `.env` file:

```env
# Required
OPENAI_API_KEY=your-openai-api-key
EMBEDDING_DIM=1536  # Default dimensions for text-embedding-3-small

# Database (should already be configured)
DB_HOST=your-supabase-host
DB_PORT=5432
DB_USERNAME=your-username
DB_PASSWORD=your-password
DB_NAME=your-database
```

### 2. Run Migrations

```bash
# Run the embeddings table migration
npm run migration:run

# Optional: Run RLS migration for Supabase deployments
# Edit the RLS migration file first to match your JWT structure
```

## Usage

### Basic Usage in Code

```typescript
import { vectorStoreService } from "./services/vector-store.service";

// Initialize (after DataSource is ready)
await vectorStoreService.initialize();

// Add embeddings
const chunks = [
  { content: "First chunk of text", metadata: { source: "doc1" } },
  { content: "Second chunk of text", metadata: { source: "doc1" } }
];

const ids = await vectorStoreService.addChunks(
  organizationId,
  documentId,  // optional
  chunks
);

// Search for similar content
const results = await vectorStoreService.search(
  organizationId,
  "search query",
  10  // top K results
);
```

### Running the Example Script

```bash
# Set environment variables
export ORGANIZATION_ID="your-org-uuid"
export DOCUMENT_ID="your-doc-uuid"  # optional

# Run the example
cd server
npx ts-node scripts/ingest-example.ts

# With cleanup
CLEANUP=true npx ts-node scripts/ingest-example.ts
```

## Architecture

### Database Schema

The `embeddings` table structure:
- `id`: UUID primary key
- `organizationId`: UUID for multi-tenancy
- `documentId`: Optional UUID linking to documents
- `content`: The text content
- `metadata`: JSONB for additional data
- `embedding`: vector(1536) for similarity search

### Indexes

1. **B-tree index** on `organizationId` for filtering
2. **HNSW index** on `embedding` using cosine distance for similarity search

### Performance Optimization

For large-scale deployments:

1. **Partial HNSW indexes** per large organization:
```sql
CREATE INDEX embeddings_embedding_hnsw_org_xyz
ON embeddings USING hnsw (embedding vector_cosine_ops)
WHERE "organizationId" = 'specific-org-uuid';
```

2. **LIST partitioning** for massive scale (see migration comments)

## API Reference

### VectorStoreService Methods

#### `initialize()`
Initialize the vector store. Must be called after DataSource is initialized.

#### `addChunks(orgId, docId, chunks)`
Add text chunks to the vector store.
- Returns: Array of embedding IDs

#### `search(orgId, query, k)`
Search for similar content within an organization.
- Returns: Array of results with similarity scores

#### `deleteByDocumentId(orgId, docId)`
Delete all embeddings for a document.
- Returns: Number of deleted rows

#### `getStatistics(orgId)`
Get embedding statistics for an organization.
- Returns: Statistics object

## Switching Embedding Models

To use a different embedding model:

1. Update `.env`:
```env
OPENAI_EMBEDDING_MODEL=text-embedding-3-large
EMBEDDING_DIM=3072  # For large model
```

2. Create a new migration to update the vector dimension:
```sql
ALTER TABLE embeddings 
ALTER COLUMN embedding TYPE vector(3072);
```

## Switching Distance Metrics

Currently using cosine distance (default). To switch:

### For L2 (Euclidean) distance:
```sql
-- Drop old index
DROP INDEX embeddings_embedding_hnsw;

-- Create new index with L2
CREATE INDEX embeddings_embedding_hnsw 
ON embeddings USING hnsw (embedding vector_l2_ops);

-- Update queries to use <-> operator
```

### For Inner Product:
```sql
-- Create index with inner product
CREATE INDEX embeddings_embedding_hnsw 
ON embeddings USING hnsw (embedding vector_ip_ops);

-- Update queries to use <#> operator
```

## Troubleshooting

### Extension not found
```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### Performance issues
1. Check index usage: `EXPLAIN ANALYZE your_query`
2. Consider partial indexes for large orgs
3. Monitor `lists` and `ef_construction` HNSW parameters

### Multi-tenancy concerns
- Always filter by `organizationId` first
- Use RLS policies in Supabase deployments
- Consider partitioning for 1000+ organizations

## Testing

Run the integration tests:
```bash
npm test -- tests/integration/vector-store.test.ts
```

## Security Considerations

1. **Multi-tenancy**: All queries are scoped by `organizationId`
2. **RLS**: Optional Row-Level Security for Supabase
3. **API Keys**: Store OpenAI keys securely
4. **Data deletion**: Cascade delete with documents

## Resources

- [pgvector documentation](https://github.com/pgvector/pgvector)
- [LangChain TypeORM integration](https://js.langchain.com/docs/integrations/vectorstores/typeorm)
- [OpenAI embeddings](https://platform.openai.com/docs/guides/embeddings)