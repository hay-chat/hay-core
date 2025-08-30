import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrchestratorFields1756475796201 implements MigrationInterface {
    name = 'AddOrchestratorFields1756475796201'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "embeddings" DROP CONSTRAINT "FK_embeddings_document"`);
        await queryRunner.query(`ALTER TABLE "embeddings" DROP CONSTRAINT "FK_embeddings_organization"`);
        await queryRunner.query(`ALTER TABLE "playbook_agents" DROP CONSTRAINT "FK_278f149f776ced72339565b23e7"`);
        await queryRunner.query(`ALTER TABLE "playbook_agents" DROP CONSTRAINT "FK_e7b9d82972f8c1db4bdf93b9a9e"`);
        await queryRunner.query(`DROP INDEX "public"."embeddings_embedding_hnsw"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5eab12832ca48b139fe25a1856"`);
        await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "search_vector"`);
        await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "embedding"`);
        await queryRunner.query(`CREATE TYPE "public"."playbooks_kind_enum" AS ENUM('welcome', 'ender', 'custom')`);
        await queryRunner.query(`ALTER TABLE "playbooks" ADD "kind" "public"."playbooks_kind_enum" NOT NULL DEFAULT 'custom'`);
        await queryRunner.query(`ALTER TABLE "playbooks" ADD "required_fields" jsonb`);
        await queryRunner.query(`ALTER TABLE "playbooks" ADD "prompt_template" text`);
        await queryRunner.query(`ALTER TABLE "playbooks" ADD "is_system" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "playbook_agents" ADD CONSTRAINT "PK_5eab12832ca48b139fe25a1856f" PRIMARY KEY ("playbook_id", "agent_id")`);
        await queryRunner.query(`ALTER TABLE "embeddings" DROP COLUMN "embedding"`);
        await queryRunner.query(`ALTER TABLE "embeddings" ADD "embedding" text`);
        await queryRunner.query(`ALTER TYPE "public"."playbook_status_enum" RENAME TO "playbook_status_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."playbooks_status_enum" AS ENUM('draft', 'active', 'archived')`);
        await queryRunner.query(`ALTER TABLE "playbooks" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "playbooks" ALTER COLUMN "status" TYPE "public"."playbooks_status_enum" USING "status"::"text"::"public"."playbooks_status_enum"`);
        await queryRunner.query(`ALTER TABLE "playbooks" ALTER COLUMN "status" SET DEFAULT 'draft'`);
        await queryRunner.query(`DROP TYPE "public"."playbook_status_enum_old"`);
        await queryRunner.query(`CREATE INDEX "IDX_e7b9d82972f8c1db4bdf93b9a9" ON "playbook_agents" ("playbook_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_278f149f776ced72339565b23e" ON "playbook_agents" ("agent_id") `);
        await queryRunner.query(`ALTER TABLE "embeddings" ADD CONSTRAINT "FK_0cdb93a0c14a460187deb0a5174" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "embeddings" ADD CONSTRAINT "FK_0908b25a0d284de1f5126043b10" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "playbook_agents" ADD CONSTRAINT "FK_e7b9d82972f8c1db4bdf93b9a9e" FOREIGN KEY ("playbook_id") REFERENCES "playbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "playbook_agents" ADD CONSTRAINT "FK_278f149f776ced72339565b23e7" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "playbook_agents" DROP CONSTRAINT "FK_278f149f776ced72339565b23e7"`);
        await queryRunner.query(`ALTER TABLE "playbook_agents" DROP CONSTRAINT "FK_e7b9d82972f8c1db4bdf93b9a9e"`);
        await queryRunner.query(`ALTER TABLE "embeddings" DROP CONSTRAINT "FK_0908b25a0d284de1f5126043b10"`);
        await queryRunner.query(`ALTER TABLE "embeddings" DROP CONSTRAINT "FK_0cdb93a0c14a460187deb0a5174"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_278f149f776ced72339565b23e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e7b9d82972f8c1db4bdf93b9a9"`);
        await queryRunner.query(`CREATE TYPE "public"."playbook_status_enum_old" AS ENUM('draft', 'active', 'archived')`);
        await queryRunner.query(`ALTER TABLE "playbooks" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "playbooks" ALTER COLUMN "status" TYPE "public"."playbook_status_enum_old" USING "status"::"text"::"public"."playbook_status_enum_old"`);
        await queryRunner.query(`ALTER TABLE "playbooks" ALTER COLUMN "status" SET DEFAULT 'draft'`);
        await queryRunner.query(`DROP TYPE "public"."playbooks_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."playbook_status_enum_old" RENAME TO "playbook_status_enum"`);
        await queryRunner.query(`ALTER TABLE "embeddings" DROP COLUMN "embedding"`);
        await queryRunner.query(`ALTER TABLE "embeddings" ADD "embedding" vector`);
        await queryRunner.query(`ALTER TABLE "playbook_agents" DROP CONSTRAINT "PK_5eab12832ca48b139fe25a1856f"`);
        await queryRunner.query(`ALTER TABLE "playbooks" DROP COLUMN "is_system"`);
        await queryRunner.query(`ALTER TABLE "playbooks" DROP COLUMN "prompt_template"`);
        await queryRunner.query(`ALTER TABLE "playbooks" DROP COLUMN "required_fields"`);
        await queryRunner.query(`ALTER TABLE "playbooks" DROP COLUMN "kind"`);
        await queryRunner.query(`DROP TYPE "public"."playbooks_kind_enum"`);
        await queryRunner.query(`ALTER TABLE "documents" ADD "embedding" text`);
        await queryRunner.query(`ALTER TABLE "documents" ADD "search_vector" tsvector`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_5eab12832ca48b139fe25a1856" ON "playbook_agents" ("agent_id", "playbook_id") `);
        await queryRunner.query(`CREATE INDEX "embeddings_embedding_hnsw" ON "embeddings" ("embedding") `);
        await queryRunner.query(`ALTER TABLE "playbook_agents" ADD CONSTRAINT "FK_e7b9d82972f8c1db4bdf93b9a9e" FOREIGN KEY ("playbook_id") REFERENCES "playbooks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "playbook_agents" ADD CONSTRAINT "FK_278f149f776ced72339565b23e7" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "embeddings" ADD CONSTRAINT "FK_embeddings_organization" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "embeddings" ADD CONSTRAINT "FK_embeddings_document" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
