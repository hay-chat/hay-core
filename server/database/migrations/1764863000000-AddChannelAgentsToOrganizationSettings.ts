import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add Channel Agents Support to Organization Settings
 *
 * This migration documents the addition of channelAgents to the organization settings JSONB field.
 * The channelAgents field allows organizations to assign different agents to different communication channels.
 *
 * Schema: { [channel: string]: agentId: string }
 * Example: { "whatsapp": "agent-uuid-1", "slack": "agent-uuid-2", "email": "agent-uuid-3" }
 *
 * Priority for agent selection:
 * 1. Channel-specific agent (organization.settings.channelAgents[channel])
 * 2. Default agent (organization.defaultAgentId)
 * 3. First available agent
 *
 * Since settings is already a JSONB column, no schema changes are required.
 * This migration serves as documentation for the new field structure.
 */
export class AddChannelAgentsToOrganizationSettings1764863000000 implements MigrationInterface {
  name = "AddChannelAgentsToOrganizationSettings1764863000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No schema changes needed - settings is already JSONB
    // The channelAgents field will be added to settings when needed

    // Add comment to document the new field
    await queryRunner.query(`
      COMMENT ON COLUMN organizations.settings IS
      'Organization settings (JSONB). Fields: testModeDefault, companyDomain, companyInterestGuardrail, confidenceGuardrail, channelAgents (Record<channel, agentId>)'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the comment
    await queryRunner.query(`
      COMMENT ON COLUMN organizations.settings IS
      'Organization settings (JSONB). Fields: testModeDefault, companyDomain, companyInterestGuardrail, confidenceGuardrail'
    `);
  }
}
