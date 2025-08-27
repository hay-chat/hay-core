# Authentication System Documentation

## Overview

This authentication system provides multiple authentication methods with proper security practices:

- **Basic Authentication**: Direct email/password authentication
- **JWT Bearer Token**: Standard token-based authentication
- **API Key Authentication**: Long-lived service access tokens

## Architecture

### Core Components

```
server/
├── entities/
│   ├── user.entity.ts          # User entity with TypeORM decorators
│   └── apikey.entity.ts        # API Key entity
├── lib/auth/
│   ├── AuthUser.ts              # AuthUser class for tRPC context
│   ├── middleware/
│   │   ├── index.ts             # Main authentication middleware
│   │   ├── basicAuth.ts         # Basic auth implementation
│   │   ├── bearerAuth.ts        # JWT bearer auth implementation
│   │   └── apiKeyAuth.ts        # API key auth implementation
│   └── utils/
│       ├── jwt.ts               # JWT token utilities
│       └── hashing.ts           # Password and API key hashing
├── trpc/
│   ├── context.ts               # tRPC context with AuthUser
│   └── auth.middleware.ts       # tRPC authentication middlewares
└── routes/v1/auth/
    └── index.ts                 # Authentication endpoints

```

## Authentication Methods

### 1. Basic Authentication

**Use Case**: Direct authentication without existing JWT

**Format**: `Authorization: Basic base64(email:password)`

**Response**: Returns JWT tokens in response headers:
- `X-Access-Token`: JWT access token
- `X-Refresh-Token`: JWT refresh token  
- `X-Token-Expires-In`: Token expiration time

### 2. Bearer Token (JWT)

**Use Case**: Standard authenticated requests

**Format**: `Authorization: Bearer <jwt-token>`

**Token Structure**:
```typescript
{
  userId: string;
  email: string;
  iat: number;  // Issued at
  exp: number;  // Expires at
}
```

### 3. API Key Authentication

**Use Case**: Service-to-service or long-lived access

**Format**: `Authorization: ApiKey <api-key>` or `Authorization: Bearer <api-key>`

**Features**:
- Cryptographically secure 32+ character keys
- Hashed storage (never stored in plain text)
- Scoped permissions
- Usage tracking

## API Endpoints

### Public Endpoints

#### Register
```typescript
POST /trpc/auth.register
{
  email: string;
  password: string;
  confirmPassword: string;
}
```

#### Login
```typescript
POST /trpc/auth.login
{
  email: string;
  password: string;
}
```

#### Refresh Token
```typescript
POST /trpc/auth.refreshToken
{
  refreshToken: string;
}
```

### Protected Endpoints

#### Get Current User
```typescript
GET /trpc/auth.me
Authorization: Bearer <token>
```

#### Change Password
```typescript
POST /trpc/auth.changePassword
Authorization: Bearer <token>
{
  currentPassword: string;
  newPassword: string;
}
```

#### Create API Key
```typescript
POST /trpc/auth.createApiKey
Authorization: Bearer <token>
{
  name: string;
  expiresAt?: Date;
  scopes?: Array<{
    resource: string;
    actions: string[];
  }>;
}
```

#### List API Keys
```typescript
GET /trpc/auth.listApiKeys
Authorization: Bearer <token>
```

#### Revoke API Key
```typescript
POST /trpc/auth.revokeApiKey
Authorization: Bearer <token>
{
  id: string;
}
```

### Admin Endpoints

#### List All Users
```typescript
GET /trpc/auth.listUsers
Authorization: Bearer <admin-token>
```

#### Deactivate User
```typescript
POST /trpc/auth.deactivateUser
Authorization: Bearer <admin-token>
{
  userId: string;
}
```

## Security Features

### Password Security
- Argon2 hashing (default) with configurable parameters
- BCrypt support for legacy compatibility
- Minimum 8 character password requirement
- Password confirmation on registration

### Token Security
- JWT tokens with configurable expiration (15 minutes default)
- Refresh tokens for long-lived sessions (7 days default)
- HS256 algorithm for JWT signing
- Secure token generation using crypto.randomBytes

### API Key Security
- 32-character cryptographically secure keys
- SHA-256 hashing for storage
- Timing-safe comparison to prevent timing attacks
- One-time display of plain key on creation
- Scoped permissions system

### Protection Mechanisms
- Timing attack protection on login failures
- Rate limiting configuration ready
- Account deactivation support
- Session tracking capability
- Secure headers for token transmission

## tRPC Context Integration

The authentication system integrates seamlessly with tRPC:

```typescript
// Context structure
interface Context {
  user: AuthUser | null;
  req: Request;
  res: Response;
}

// Using protected procedures
const protectedRouter = t.router({
  myProtectedEndpoint: protectedProcedure
    .query(({ ctx }) => {
      // ctx.user is guaranteed to be AuthUser
      return { userId: ctx.user.id };
    }),
});

// Using admin procedures
const adminRouter = t.router({
  adminOnly: adminProcedure
    .mutation(({ ctx }) => {
      // Only admin users can access
      return { admin: true };
    }),
});

// Using scoped procedures
const scopedRouter = t.router({
  readDocuments: scopedProcedure('documents', 'read')
    .query(({ ctx }) => {
      // User must have 'read' permission on 'documents'
      return { documents: [] };
    }),
});
```

## Configuration

Edit `server/config/auth.config.ts` to customize:

```typescript
{
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: '15m',
    refreshExpiresIn: '7d',
    algorithm: 'HS256'
  },
  bcrypt: {
    saltRounds: 12
  },
  argon2: {
    type: 2,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4
  },
  apiKey: {
    length: 32,
    prefix: 'hay_'
  }
}
```

## Environment Variables

```env
JWT_SECRET=your-secret-key-change-in-production
NODE_ENV=production
```

## Testing

See `server/tests/auth.test.example.ts` for usage examples.

## Security Checklist

✅ Passwords hashed with salt (Argon2/BCrypt)
✅ JWT tokens have appropriate expiration
✅ API keys are hashed before storage
✅ Rate limiting configuration ready
✅ Secure session management
✅ Protection against timing attacks
✅ Input validation and sanitization
✅ TypeORM entities with proper decorators
✅ tRPC middleware for authorization
✅ Scoped permissions for API keys