import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Add Agent Role Support
 *
 * This migration documents the addition of the "agent" role to the RBAC system.
 *
 * The "agent" role is designed for limited-access support staff with the following permissions:
 * - Conversations: READ, CREATE, UPDATE
 * - Messages: READ, CREATE
 * - Customers: READ
 * - Playbooks: READ, EXECUTE
 * - Cannot access: Analytics, Settings, Admin functions
 *
 * Technical Note:
 * Since roles are stored as VARCHAR(50) without database-level enum constraints,
 * no actual schema changes are required. The role validation is handled at the
 * application layer through TypeORM entity definitions and TypeScript types.
 *
 * Tables affected (application-level only):
 * - users.role
 * - user_organizations.role
 * - organization_invitations.role
 *
 * Related Files:
 * - server/entities/user.entity.ts
 * - server/entities/user-organization.entity.ts
 * - server/entities/organization-invitation.entity.ts
 * - server/types/scopes.ts (AGENT_SCOPES definition)
 */
export class AddAgentRoleSupport1763327311000 implements MigrationInterface {
  name = "AddAgentRoleSupport1763327311000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add comments to document the agent role addition
    await queryRunner.query(`
      COMMENT ON COLUMN users.role IS 'User role: owner, admin, contributor, member, viewer, or agent';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN user_organizations.role IS 'Organization-specific role: owner, admin, contributor, member, viewer, or agent';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN organization_invitations.role IS 'Invited user role: owner, admin, contributor, member, viewer, or agent';
    `);

    // Note: No schema changes required as roles are stored as varchar(50)
    // The "agent" role is now valid and will be enforced at the application layer
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert comments to previous state
    await queryRunner.query(`
      COMMENT ON COLUMN users.role IS 'User role: owner, admin, contributor, member, or viewer';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN user_organizations.role IS 'Organization-specific role: owner, admin, contributor, member, or viewer';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN organization_invitations.role IS 'Invited user role: owner, admin, contributor, member, or viewer';
    `);

    // Note: This down migration does NOT remove existing "agent" role assignments
    // Manual data cleanup would be required if rolling back this migration
    // Run: UPDATE users SET role = 'member' WHERE role = 'agent';
    // Run: UPDATE user_organizations SET role = 'member' WHERE role = 'agent';
    // Run: DELETE FROM organization_invitations WHERE role = 'agent';
  }
}
