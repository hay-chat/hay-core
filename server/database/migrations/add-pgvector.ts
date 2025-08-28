import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPgVector1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable pgvector extension
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    
    // Check current column type
    const columnInfo = await queryRunner.query(`
      SELECT data_type, udt_name 
      FROM information_schema.columns 
      WHERE table_name = 'documents' 
      AND column_name = 'embedding'
    `);
    
    if (columnInfo.length > 0 && columnInfo[0].udt_name !== 'vector') {
      // If column exists but is not vector type, alter it
      await queryRunner.query(`
        ALTER TABLE documents 
        DROP COLUMN IF EXISTS embedding
      `);
      
      await queryRunner.query(`
        ALTER TABLE documents 
        ADD COLUMN embedding vector(1536)
      `);
    } else if (columnInfo.length === 0) {
      // If column doesn't exist, add it
      await queryRunner.query(`
        ALTER TABLE documents 
        ADD COLUMN embedding vector(1536)
      `);
    }
    
    // Create index for vector similarity search using IVFFlat
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_embedding_ivfflat
      ON documents 
      USING ivfflat (embedding vector_cosine_ops) 
      WITH (lists = 100)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the index
    await queryRunner.query(`DROP INDEX IF EXISTS idx_documents_embedding_ivfflat`);
    
    // Drop the vector column
    await queryRunner.query(`
      ALTER TABLE documents 
      DROP COLUMN IF EXISTS embedding
    `);
  }
}