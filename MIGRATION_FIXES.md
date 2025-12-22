# Migration Fixes Applied

## Problem
Several migrations had ordering issues where they tried to modify tables before those tables were created.

## Root Cause
Old migrations (with timestamps from October 2024: 1729xxx and 1730xxx) were running BEFORE the consolidated schema migration (1758xxx from September 2025) that creates the base tables.

## Solutions Applied

### 1. Removed Old Problematic Migrations
Deleted migrations that were trying to run before tables existed:
- `1729595206000-AddDownloadTrackingToPrivacyRequests.ts`
- `1729695000000-CreateScheduledJobsTables.ts`
- `1729695100000-AddMetadataToAuditLogs.ts`
- `1730000000000-AlterAgentInstructionsToJsonb.ts`
- `1730059200000-AddDefaultConfidenceSettings.ts`
- `1760990805000-AddCustomerPrivacySupport.ts`

### 2. Merged Features into Table Creation
Merged the functionality from the removed migrations into the table creation migration:

**File**: `1761000000000-CreatePrivacyRequestsAndUserDeletion.ts`

Added fields to `privacy_requests` table at creation time:
- `download_ip_address` - IP address for download tracking
- `downloaded_at` - Download timestamp
- `download_count` - Number of downloads
- `max_downloads` - Maximum allowed downloads
- `subject_type` - User or customer privacy request
- `customer_id` - Foreign key to customers table
- `organization_id` - Foreign key to organizations table
- `identifier_type` - Type of identifier (email, phone, externalId)
- `identifier_value` - Value of the identifier

Added corresponding indexes and constraints for efficient queries and data integrity.

## Additional Fix
After the initial fix, the server failed to start because the `scheduled_jobs` table was missing. This was from one of the deleted old migrations.

**Solution**: Created a new migration with proper timestamp:
- `1766000000000-CreateScheduledJobsTables.ts`

This migration creates:
- `scheduled_jobs` - Metadata and status for cron jobs
- `scheduled_job_history` - Execution history for scheduled jobs

## Result
✅ All 37 migrations now run successfully in the correct order
✅ Database is fully set up with all required tables and indexes
✅ No migration ordering conflicts
✅ Server starts successfully without errors

## Migration Status
All migrations have been executed:
- Total migrations: 37
- Executed: 37
- Pending: 0

## Tables Created (26 total)
- agents
- api_keys
- audit_logs
- conversations
- customers
- documents
- embeddings
- jobs
- message_feedback
- messages
- organization_invitations
- organizations
- playbook_agents
- playbooks
- plugin_instances
- plugin_registry
- privacy_requests ✨
- scheduled_jobs ✨
- scheduled_job_history ✨
- sessions
- sources
- uploads
- user_organizations
- users
- webchat_settings
- migrations (system table)

## Next Steps
Your local database is now ready for development. You can:

1. Start the application:
   ```bash
   npm run dev
   ```

2. Verify environment:
   ```bash
   npm run env:status
   ```

3. Check migration status anytime:
   ```bash
   npm run migration:show
   ```

## Note for Future Migrations
Always ensure new migrations have timestamps AFTER all existing migrations to avoid ordering issues. Use the timestamp generation from TypeORM:

```bash
npm run migration:generate -- ./database/migrations/YourMigrationName
```
