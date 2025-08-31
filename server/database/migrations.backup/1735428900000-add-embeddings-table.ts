import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEmbeddingsTable1735428900000 implements MigrationInterface {
  name = "AddEmbeddingsTable1735428900000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable required extensions (idempotent)
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    // Create embeddings table
    const embeddingDim = process.env.EMBEDDING_DIM || "1536";
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "documentId" uuid,
        "pageContent" text NOT NULL,
        metadata jsonb,
        embedding vector(${embeddingDim}) NOT NULL,
        CONSTRAINT "FK_embeddings_organization" FOREIGN KEY ("organizationId") 
          REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT "FK_embeddings_document" FOREIGN KEY ("documentId") 
          REFERENCES documents(id) ON DELETE CASCADE
      )
    `);

    // Create indexes
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS embeddings_org_id_idx 
      ON embeddings ("organizationId")
    `);

    // Create HNSW index for vector similarity search (cosine distance)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS embeddings_embedding_hnsw 
      ON embeddings USING hnsw (embedding vector_cosine_ops)
    `);

    // Optional: Example of partial HNSW index for large organizations
    // This is commented out by default but shows how to create indexes for specific orgs
    await queryRunner.query(`
      -- Example: Create partial HNSW index for a specific large organization
      -- This improves performance when an org has millions of embeddings
      -- CREATE INDEX IF NOT EXISTS embeddings_embedding_hnsw_org_xyz
      -- ON embeddings USING hnsw (embedding vector_cosine_ops)
      -- WHERE "organizationId" = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
    `);

    // Optional: Example of LIST partitioning for very large deployments
    await queryRunner.query(`
      -- Example: LIST partitioning by organization_id for massive scale
      -- This is useful when you have thousands of organizations with millions of embeddings each
      -- 
      -- 1. Create partitioned table:
      -- CREATE TABLE embeddings_partitioned (
      --   LIKE embeddings INCLUDING ALL
      -- ) PARTITION BY LIST ("organizationId");
      -- 
      -- 2. Create partitions for each org:
      -- CREATE TABLE embeddings_org_abc PARTITION OF embeddings_partitioned
      -- FOR VALUES IN ('org-uuid-abc');
      -- 
      -- 3. Move data from original table to partitioned table
      -- INSERT INTO embeddings_partitioned SELECT * FROM embeddings;
      -- 
      -- 4. Rename tables
      -- ALTER TABLE embeddings RENAME TO embeddings_old;
      -- ALTER TABLE embeddings_partitioned RENAME TO embeddings;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS embeddings_embedding_hnsw`);
    await queryRunner.query(`DROP INDEX IF EXISTS embeddings_org_id_idx`);
    
    // Drop table
    await queryRunner.query(`DROP TABLE IF EXISTS embeddings`);
    
    // Note: We don't drop extensions as they might be used by other tables
  }
}