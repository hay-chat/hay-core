import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Convert embeddings.embedding from text to vector(1536) and add an HNSW
 * index for cosine similarity.
 *
 * Background: the consolidated initial schema declared the column as text,
 * which forced every similarity search to parse a ~19 KB text payload into
 * a 1536-dim vector per row before computing cosine distance. With ~60k
 * rows in the largest org, a single topK=5 search took 100–150 s in prod.
 *
 * This migration rewrites the column to the native vector type and adds an
 * HNSW cosine index, restoring the design that existed before migration
 * consolidation. Holds ACCESS EXCLUSIVE on the embeddings table for the
 * duration of both the rewrite and the index build — run inside a planned
 * maintenance window.
 *
 * Pairs with code changes in server/services/vector-store.service.ts that
 * remove the now-incorrect `embedding::vector` casts (the planner would
 * not match an HNSW index against the casted expression).
 */
export class ConvertEmbeddingToVectorAndAddHnswIndex1781200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // pgvector must be present. No-op if already installed.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    // DO managed Postgres has a bounded /dev/shm and rejects multi-GB DSM
    // segment allocations. pgvector's HNSW build allocates a DSM segment
    // proportional to maintenance_work_mem to coordinate parallel maintenance
    // workers; with workers disabled, the build is single-threaded and uses
    // per-backend RAM instead. 1 GB maintenance_work_mem keeps the build in
    // memory for ~200k × 1536-dim vectors without hitting shared-memory.
    await queryRunner.query(`SET LOCAL max_parallel_maintenance_workers = 0`);
    await queryRunner.query(`SET LOCAL maintenance_work_mem = '1GB'`);

    // Rewrite the column. Every existing row's text payload of the form
    // '[v1,v2,...,v1536]' is parsed into a native pgvector value.
    await queryRunner.query(
      `ALTER TABLE "embeddings" ALTER COLUMN "embedding" TYPE vector(1536) USING "embedding"::vector(1536)`,
    );

    // HNSW for cosine distance. m=16, ef_construction=64 are pgvector defaults
    // and work well for 1536-dim OpenAI embeddings.
    await queryRunner.query(
      `CREATE INDEX "embeddings_embedding_hnsw_idx" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "embeddings_embedding_hnsw_idx"`);

    // Revert to text. Postgres serializes vector(N) values back to the
    // '[v1,v2,...]' form, round-tripping with the application's prior
    // transformer (now removed from the entity).
    await queryRunner.query(
      `ALTER TABLE "embeddings" ALTER COLUMN "embedding" TYPE text USING "embedding"::text`,
    );
  }
}
