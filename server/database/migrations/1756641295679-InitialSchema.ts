import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1756641295679 implements MigrationInterface {
  name = "InitialSchema1756641295679";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "documents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" character varying, "updated_by" character varying, "metadata" jsonb, "organization_id" uuid NOT NULL, "title" character varying, "description" character varying, "type" "public"."documents_type_enum" NOT NULL DEFAULT 'article', "status" "public"."documents_status_enum" NOT NULL DEFAULT 'draft', "visibility" "public"."documents_visibility_enum" NOT NULL DEFAULT 'private', "tags" text, "categories" text, "attachments" jsonb, "content" text, "embedding_metadata" jsonb, CONSTRAINT "PK_ac51aa5181ee2036f5ca482857c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "api_keys" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" character varying, "updated_by" character varying, "metadata" jsonb, "user_id" uuid NOT NULL, "organization_id" uuid, "key_hash" character varying(255) NOT NULL, "name" character varying(255) NOT NULL, "last_used_at" TIMESTAMP WITH TIME ZONE, "expires_at" TIMESTAMP WITH TIME ZONE, "scopes" jsonb NOT NULL DEFAULT '[]', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_5c8a79801b44bd27b79228e1dad" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_api_keys_organization" ON "api_keys" ("organization_id") `,
    );
    await queryRunner.query(`CREATE INDEX "idx_api_keys_is_active" ON "api_keys" ("is_active") `);
    await queryRunner.query(`CREATE INDEX "idx_api_keys_key_hash" ON "api_keys" ("key_hash") `);
    await queryRunner.query(`CREATE INDEX "idx_api_keys_user_id" ON "api_keys" ("user_id") `);
    await queryRunner.query(
      `CREATE TABLE "jobs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" character varying, "updated_by" character varying, "metadata" jsonb, "organization_id" uuid NOT NULL, "title" character varying, "description" character varying, "status" "public"."jobs_status_enum" NOT NULL DEFAULT 'pending', "priority" "public"."jobs_priority_enum" NOT NULL DEFAULT '1', "data" jsonb, "result" jsonb, CONSTRAINT "PK_cf0a6c42b72fcc7f7c237def345" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "organizations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" character varying, "updated_by" character varying, "metadata" jsonb, "name" character varying(255) NOT NULL, "slug" character varying(255) NOT NULL, "description" character varying(500), "is_active" boolean NOT NULL DEFAULT true, "logo" character varying(255), "website" character varying(255), "settings" jsonb, "limits" jsonb, "plan" character varying(50) NOT NULL DEFAULT 'free', "trial_ends_at" TIMESTAMP WITH TIME ZONE, "billing_email" character varying(255), CONSTRAINT "UQ_963693341bd612aa01ddf3a4b68" UNIQUE ("slug"), CONSTRAINT "PK_6b031fcd0863e3f6b44230163f9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_organizations_is_active" ON "organizations" ("is_active") `,
    );
    await queryRunner.query(`CREATE INDEX "idx_organizations_slug" ON "organizations" ("slug") `);
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" character varying, "updated_by" character varying, "metadata" jsonb, "email" character varying(255) NOT NULL, "password" character varying(255) NOT NULL, "first_name" character varying(255), "last_name" character varying(255), "is_active" boolean NOT NULL DEFAULT true, "last_login_at" TIMESTAMP WITH TIME ZONE, "organization_id" uuid, "role" character varying(50) NOT NULL DEFAULT 'member', "permissions" jsonb, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_users_organization" ON "users" ("organization_id") `,
    );
    await queryRunner.query(`CREATE INDEX "idx_users_is_active" ON "users" ("is_active") `);
    await queryRunner.query(`CREATE INDEX "idx_users_email" ON "users" ("email") `);
    await queryRunner.query(
      `CREATE TABLE "sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" character varying, "updated_by" character varying, "metadata" jsonb, "user_id" uuid NOT NULL, "refresh_token_hash" character varying(255) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "last_activity" TIMESTAMP WITH TIME ZONE NOT NULL, "ip_address" character varying(255), "user_agent" text, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_3238ef96f18b355b671619111bc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "idx_sessions_expires_at" ON "sessions" ("expires_at") `);
    await queryRunner.query(
      `CREATE INDEX "idx_sessions_refresh_token_hash" ON "sessions" ("refresh_token_hash") `,
    );
    await queryRunner.query(`CREATE INDEX "idx_sessions_user_id" ON "sessions" ("user_id") `);
    await queryRunner.query(
      `CREATE TABLE "embeddings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "document_id" uuid, "page_content" text NOT NULL, "metadata" jsonb, "embedding" text, CONSTRAINT "PK_19b6b451e1ef345884caca1f544" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "embeddings_org_id_idx" ON "embeddings" ("organization_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "playbooks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(255) NOT NULL, "trigger" character varying(255) NOT NULL, "description" text, "instructions" jsonb, "kind" "public"."playbooks_kind_enum" NOT NULL DEFAULT 'custom', "required_fields" jsonb, "prompt_template" text, "is_system" boolean NOT NULL DEFAULT false, "status" "public"."playbooks_status_enum" NOT NULL DEFAULT 'draft', "organization_id" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_700979398c237ee843f513f51ce" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "agents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(255) NOT NULL, "description" text, "enabled" boolean NOT NULL DEFAULT true, "instructions" text, "organization_id" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_9c653f28ae19c5884d5baf6a1d9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "conversation_id" uuid NOT NULL, "content" text NOT NULL, "type" "public"."messages_type_enum" NOT NULL, "usage_metadata" jsonb, "sender" character varying(100), "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "customers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "external_id" character varying(255), "email" character varying(255), "phone" character varying(50), "name" character varying(255), "notes" text, "external_metadata" jsonb, "organization_id" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_133ec679a801fab5e070f73d3ea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fd8ff15d87714c6b6b955262c1" ON "customers" ("organization_id", "email") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e657a38782ca3690fa2fbf254b" ON "customers" ("organization_id", "external_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "conversations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(255) NOT NULL, "status" "public"."conversations_status_enum" NOT NULL DEFAULT 'open', "cooldown_until" TIMESTAMP WITH TIME ZONE, "last_user_message_at" TIMESTAMP WITH TIME ZONE, "ended_at" TIMESTAMP WITH TIME ZONE, "closed_at" TIMESTAMP WITH TIME ZONE, "context" jsonb, "resolution_metadata" jsonb, "agent_id" uuid, "organization_id" uuid NOT NULL, "playbook_id" uuid, "metadata" jsonb, "needs_processing" boolean NOT NULL DEFAULT false, "last_processed_at" TIMESTAMP WITH TIME ZONE, "customer_id" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ee34f4f7ced4ec8681f26bf04ef" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "plugin_registry" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(255) NOT NULL, "version" character varying(50) NOT NULL, "manifest" jsonb NOT NULL, "installed" boolean NOT NULL DEFAULT false, "built" boolean NOT NULL DEFAULT false, "last_install_error" text, "last_build_error" text, "installed_at" TIMESTAMP WITH TIME ZONE, "built_at" TIMESTAMP WITH TIME ZONE, "checksum" character varying(64), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_13b99bc368ebbe1ef2430e3a2cc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ca98e6c96725b732c954a6afc8" ON "plugin_registry" ("name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "plugin_instances" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" character varying, "updated_by" character varying, "metadata" jsonb, "organization_id" uuid NOT NULL, "plugin_id" uuid NOT NULL, "enabled" boolean NOT NULL DEFAULT false, "config" jsonb, "running" boolean NOT NULL DEFAULT false, "process_id" character varying, "last_started_at" TIMESTAMP WITH TIME ZONE, "last_stopped_at" TIMESTAMP WITH TIME ZONE, "last_error" text, "restart_count" integer NOT NULL DEFAULT '0', "last_health_check" TIMESTAMP WITH TIME ZONE, "status" character varying(50) NOT NULL DEFAULT 'stopped', CONSTRAINT "PK_1d261e16e830f63f75f2060863d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_eeb460732b394d922625cabc09" ON "plugin_instances" ("organization_id", "plugin_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "playbook_agents" ("playbook_id" uuid NOT NULL, "agent_id" uuid NOT NULL, CONSTRAINT "PK_5eab12832ca48b139fe25a1856f" PRIMARY KEY ("playbook_id", "agent_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e7b9d82972f8c1db4bdf93b9a9" ON "playbook_agents" ("playbook_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_278f149f776ced72339565b23e" ON "playbook_agents" ("agent_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD CONSTRAINT "FK_69427761f37533ae7767601a64b" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "api_keys" ADD CONSTRAINT "FK_a3baee01d8408cd3c0f89a9a973" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "api_keys" ADD CONSTRAINT "FK_a283bdef18876e525aefaec042f" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD CONSTRAINT "FK_3d9a2080fffe3e2c3b72fd56df2" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_21a659804ed7bf61eb91688dea7" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "embeddings" ADD CONSTRAINT "FK_7b03f1649a7fd45dc933d67bcda" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "embeddings" ADD CONSTRAINT "FK_af7cbcfb2b78ba6e749aa419dfa" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "playbooks" ADD CONSTRAINT "FK_bc94e9eb46821ac889e0eb8ff8c" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "agents" ADD CONSTRAINT "FK_28ac537f8c7bc3c96f7d1753ec4" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_3bc55a7c3f9ed54b520bb5cfe23" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers" ADD CONSTRAINT "FK_d2fc0e42b07d01fafc3fbb2bee3" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_9f32ead8384a1a92e073a7c006a" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_87d9df8c99fb824a39c681ec332" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_c9f0434c15cacf894e996f69088" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "plugin_instances" ADD CONSTRAINT "FK_2640efc3355bdcf8627dde0348f" FOREIGN KEY ("plugin_id") REFERENCES "plugin_registry"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "plugin_instances" ADD CONSTRAINT "FK_3351804d975a13769f702c5b518" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "playbook_agents" ADD CONSTRAINT "FK_e7b9d82972f8c1db4bdf93b9a9e" FOREIGN KEY ("playbook_id") REFERENCES "playbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "playbook_agents" ADD CONSTRAINT "FK_278f149f776ced72339565b23e7" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "playbook_agents" DROP CONSTRAINT "FK_278f149f776ced72339565b23e7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "playbook_agents" DROP CONSTRAINT "FK_e7b9d82972f8c1db4bdf93b9a9e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "plugin_instances" DROP CONSTRAINT "FK_3351804d975a13769f702c5b518"`,
    );
    await queryRunner.query(
      `ALTER TABLE "plugin_instances" DROP CONSTRAINT "FK_2640efc3355bdcf8627dde0348f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "FK_c9f0434c15cacf894e996f69088"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "FK_87d9df8c99fb824a39c681ec332"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "FK_9f32ead8384a1a92e073a7c006a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers" DROP CONSTRAINT "FK_d2fc0e42b07d01fafc3fbb2bee3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT "FK_3bc55a7c3f9ed54b520bb5cfe23"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agents" DROP CONSTRAINT "FK_28ac537f8c7bc3c96f7d1753ec4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "playbooks" DROP CONSTRAINT "FK_bc94e9eb46821ac889e0eb8ff8c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "embeddings" DROP CONSTRAINT "FK_af7cbcfb2b78ba6e749aa419dfa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "embeddings" DROP CONSTRAINT "FK_7b03f1649a7fd45dc933d67bcda"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" DROP CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_21a659804ed7bf61eb91688dea7"`);
    await queryRunner.query(`ALTER TABLE "jobs" DROP CONSTRAINT "FK_3d9a2080fffe3e2c3b72fd56df2"`);
    await queryRunner.query(
      `ALTER TABLE "api_keys" DROP CONSTRAINT "FK_a283bdef18876e525aefaec042f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "api_keys" DROP CONSTRAINT "FK_a3baee01d8408cd3c0f89a9a973"`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" DROP CONSTRAINT "FK_69427761f37533ae7767601a64b"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_278f149f776ced72339565b23e"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e7b9d82972f8c1db4bdf93b9a9"`);
    await queryRunner.query(`DROP TABLE "playbook_agents"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_eeb460732b394d922625cabc09"`);
    await queryRunner.query(`DROP TABLE "plugin_instances"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ca98e6c96725b732c954a6afc8"`);
    await queryRunner.query(`DROP TABLE "plugin_registry"`);
    await queryRunner.query(`DROP TABLE "conversations"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e657a38782ca3690fa2fbf254b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fd8ff15d87714c6b6b955262c1"`);
    await queryRunner.query(`DROP TABLE "customers"`);
    await queryRunner.query(`DROP TABLE "messages"`);
    await queryRunner.query(`DROP TABLE "agents"`);
    await queryRunner.query(`DROP TABLE "playbooks"`);
    await queryRunner.query(`DROP INDEX "public"."embeddings_org_id_idx"`);
    await queryRunner.query(`DROP TABLE "embeddings"`);
    await queryRunner.query(`DROP INDEX "public"."idx_sessions_user_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_sessions_refresh_token_hash"`);
    await queryRunner.query(`DROP INDEX "public"."idx_sessions_expires_at"`);
    await queryRunner.query(`DROP TABLE "sessions"`);
    await queryRunner.query(`DROP INDEX "public"."idx_users_email"`);
    await queryRunner.query(`DROP INDEX "public"."idx_users_is_active"`);
    await queryRunner.query(`DROP INDEX "public"."idx_users_organization"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP INDEX "public"."idx_organizations_slug"`);
    await queryRunner.query(`DROP INDEX "public"."idx_organizations_is_active"`);
    await queryRunner.query(`DROP TABLE "organizations"`);
    await queryRunner.query(`DROP TABLE "jobs"`);
    await queryRunner.query(`DROP INDEX "public"."idx_api_keys_user_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_api_keys_key_hash"`);
    await queryRunner.query(`DROP INDEX "public"."idx_api_keys_is_active"`);
    await queryRunner.query(`DROP INDEX "public"."idx_api_keys_organization"`);
    await queryRunner.query(`DROP TABLE "api_keys"`);
    await queryRunner.query(`DROP TABLE "documents"`);
  }
}
