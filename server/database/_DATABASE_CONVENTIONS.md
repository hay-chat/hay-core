# Database Naming Conventions and Strategy

## Decision Summary
**Database**: PostgreSQL with snake_case naming
**Application**: TypeScript with camelCase naming  
**Bridge**: TypeORM SnakeNamingStrategy for automatic conversion

## Why This Approach?

1. **Database Best Practices**: snake_case is the SQL/PostgreSQL standard
2. **TypeScript Best Practices**: camelCase is the JavaScript/TypeScript standard
3. **Automatic Conversion**: TypeORM's naming strategy handles the mapping seamlessly
4. **No Confusion**: Clear separation between database and application layers
5. **Industry Standard**: This is how most professional Node.js/PostgreSQL applications are built

## Naming Rules

### Database Layer (PostgreSQL)
- **Tables**: Plural, snake_case (e.g., `users`, `api_keys`, `plugin_instances`)
- **Columns**: snake_case (e.g., `first_name`, `created_at`, `organization_id`)
- **Indexes**: `idx_tablename_column` (e.g., `idx_users_email`)
- **Foreign Keys**: `fk_tablename_column` (e.g., `fk_users_organization_id`)
- **Primary Keys**: Always `id` (UUID type)
- **Timestamps**: `created_at`, `updated_at` (timestamptz)
- **Booleans**: `is_` prefix (e.g., `is_active`, `is_deleted`)
- **Foreign Key Columns**: `entity_id` (e.g., `user_id`, `organization_id`)

### Application Layer (TypeScript/TypeORM)
- **Entity Classes**: PascalCase singular (e.g., `User`, `ApiKey`, `PluginInstance`)
- **Properties**: camelCase (e.g., `firstName`, `createdAt`, `organizationId`)
- **Methods**: camelCase (e.g., `getFullName()`, `hasPermission()`)
- **Relations**: camelCase (e.g., `organization`, `users`)

### TypeORM Entity Rules

#### DO NOT:
```typescript
// ❌ WRONG - Don't specify column names explicitly
@Column({ name: "first_name" })
firstName: string;

// ❌ WRONG - Don't use snake_case in TypeScript
@Column()
first_name: string;
```

#### DO:
```typescript
// ✅ CORRECT - Let naming strategy handle it
@Column()
firstName: string;

// ✅ CORRECT - Only specify name for special cases (legacy compatibility)
@JoinColumn({ name: "organization_id" }) // Only for foreign keys if needed
organization: Organization;
```

## Base Entity Pattern

All entities should extend from our BaseEntity:

```typescript
@Entity("table_name") // Table name explicitly in snake_case plural
export class EntityName extends BaseEntity {
  // Properties in camelCase
  @Column()
  propertyName: string;
}
```

## Migration Strategy

1. **Initial Migration**: Single migration file that creates entire schema
2. **Development**: Generate new migrations for schema changes
3. **Production**: Run migrations in order, never use `synchronize: true`
4. **Naming**: Migration files use descriptive names (e.g., `1234567890-CreateInitialSchema.ts`)

## Data Source Configuration

```typescript
export const AppDataSource = new DataSource({
  // ... other config
  namingStrategy: new SnakeNamingStrategy(), // CRITICAL: Always include this
  synchronize: false, // NEVER true in production
  // ...
});
```

## Common Patterns

### Timestamps
Every entity gets these from BaseEntity:
- `createdAt` → `created_at` in database
- `updatedAt` → `updated_at` in database

### Soft Deletes
If needed:
- `deletedAt` → `deleted_at` in database

### User Tracking
- `createdBy` → `created_by` in database  
- `updatedBy` → `updated_by` in database

### Organization Scoping
- `organizationId` → `organization_id` in database

## Examples

### Entity Definition
```typescript
@Entity("products")
export class Product extends BaseEntity {
  @Column({ type: "varchar", length: 255 })
  productName: string; // → product_name in DB

  @Column({ type: "decimal", precision: 10, scale: 2 })
  unitPrice: number; // → unit_price in DB

  @Column({ type: "boolean", default: true })
  isActive: boolean; // → is_active in DB

  @ManyToOne(() => Category)
  @JoinColumn() // Let naming strategy handle the column name
  category: Category; // → category_id in DB
}
```

### Query Examples
```typescript
// TypeScript uses camelCase
const user = await userRepository.findOne({
  where: { 
    firstName: "John",  // TypeORM converts to first_name
    isActive: true      // TypeORM converts to is_active
  }
});

// Raw SQL uses snake_case
const result = await queryRunner.query(
  `SELECT * FROM users WHERE first_name = $1 AND is_active = $2`,
  ["John", true]
);
```

## Troubleshooting

### Issue: Column not found
**Cause**: Explicit column name overriding naming strategy
**Fix**: Remove `name` property from `@Column()` decorator

### Issue: Duplicate columns after migration
**Cause**: Changing between explicit names and naming strategy
**Fix**: Create new migration to drop old columns

### Issue: Foreign key constraints failing
**Cause**: Mismatched column names between entities
**Fix**: Ensure both entities use same naming approach

## Checklist for New Entities

- [ ] Entity extends BaseEntity or OrganizationScopedEntity
- [ ] No explicit `name` in @Column decorators (unless special case)
- [ ] Properties use camelCase
- [ ] Table name specified in @Entity decorator (snake_case, plural)
- [ ] Foreign keys use @JoinColumn without explicit name
- [ ] Indexes defined with clear naming pattern
- [ ] No raw SQL with camelCase column names

## Database Initialization Commands

```bash
# Development - Fresh start
dropdb hay && createdb hay
cd server
npm run migration:run

# Generate new migration after entity changes
npm run migration:generate -- ./database/migrations/DescriptiveName

# Run pending migrations
npm run migration:run

# Revert last migration
npm run migration:revert
```

## Important Notes

1. **NEVER** mix naming conventions in the same table
2. **NEVER** use `synchronize: true` in production
3. **ALWAYS** review generated migrations before running
4. **ALWAYS** test migrations on a copy of production data
5. **DOCUMENT** any deviations from these conventions

## References

- [TypeORM Naming Strategy](https://typeorm.io/naming-strategy)
- [PostgreSQL Naming Conventions](https://www.postgresql.org/docs/current/sql-syntax-lexical.html)
- [SQL Style Guide](https://www.sqlstyle.guide/)