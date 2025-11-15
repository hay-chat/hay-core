# API Key Migration Guide

## Overview

This release includes a breaking change to the API key system. User-based API keys are being converted to organization-based tokens with improved security and scoping features.

## What's Changing

### Before (User-Based API Keys)
- API keys were tied to individual users
- Limited scope control
- Single key type

### After (Organization-Based Tokens)
- API tokens are tied to organizations
- Granular scope-based permissions
- Multiple token types (full access, conversations, plugins)
- Better audit trail and usage tracking

## Migration Process

### Automatic Migration

The database migration will automatically:
1. ✅ **Preserve existing API keys** by migrating them to organization tokens
2. ✅ Map each key to its user's organization
3. ⚠️ Delete orphaned keys (where user no longer exists or has no organization)
4. ✅ Update all indexes and constraints

### Manual Steps Required

After running the migration:

1. **Review Your API Tokens**
   - Navigate to `/settings/api-tokens` in the dashboard
   - Verify all your API keys were migrated successfully
   - Check that scopes are properly set (default: full access)

2. **Update API Key References**
   - Your existing API key values will continue to work
   - No changes needed to your integration code
   - The authentication header format remains the same:
     ```
     Authorization: Bearer your-api-key-here
     ```

3. **Configure Token Scopes (Recommended)**
   - Review the scopes assigned to each token
   - Apply principle of least privilege
   - Create new tokens with limited scopes for specific use cases

## Available Token Scopes

### Conversations Scope
```json
{
  "resource": "conversations",
  "actions": ["create", "read", "update", "delete"]
}
```

### Documents Scope
```json
{
  "resource": "documents",
  "actions": ["create", "read", "update", "delete"]
}
```

### Plugins Scope
```json
{
  "resource": "plugins",
  "actions": ["execute"]
}
```

### Full Access (Default)
Empty scopes array `[]` grants full access to all resources.

## Running the Migration

```bash
cd server
npm run migration:run
```

Expected output:
```
⚠️  API KEY MIGRATION WARNING ⚠️
This migration converts user-based API keys to organization-based tokens.
Existing API keys will be PRESERVED but may need manual review.

✅ API key migration completed successfully.
📝 ACTION REQUIRED: Review your API keys in the dashboard at /settings/api-tokens
```

## Rollback

If you need to rollback this migration:

```bash
cd server
npm run migration:revert
```

**Note:** Rolling back will restore the user_id column but will NOT restore any deleted orphaned keys.

## Troubleshooting

### My API key stopped working after migration

1. Check if the key still exists in `/settings/api-tokens`
2. Verify the key wasn't orphaned (user account still exists)
3. Check the token scopes match your API usage
4. Review server logs for authentication errors

### I need to regenerate my API keys

1. Navigate to `/settings/api-tokens`
2. Click "Create New Token"
3. Select appropriate scopes
4. Copy the token value (shown only once)
5. Update your integration code with the new token
6. Delete the old token

### Orphaned keys were deleted

If you had API keys for users that no longer exist or don't have an organization:
1. These keys were non-functional anyway
2. Create new organization tokens for active users
3. Update integrations with new token values

## Support

For issues during migration:
- Review the migration logs: `npm run migration:show`
- Check database state: `psql -d your_database -c "SELECT * FROM api_keys;"`
- Contact support: support@hay.chat

## Security Improvements

The new token system provides:
- ✅ Better audit trail (organization-level tracking)
- ✅ Granular permissions (scope-based access control)
- ✅ Usage tracking (last used timestamp, usage count)
- ✅ Better token lifecycle management
- ✅ Support for token expiration
- ✅ Cleaner revocation process (organization-wide if needed)
