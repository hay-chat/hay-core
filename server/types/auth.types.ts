import { User } from "../entities/user.entity";

export interface JWTPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload extends JWTPayload {
  sessionId: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ApiKeyScope {
  resource: string;
  actions: string[];
}

// Re-export API token scopes for convenience
export {
  ApiTokenScope,
  API_TOKEN_SCOPE_GROUPS,
  API_TOKEN_SCOPE_DESCRIPTIONS,
} from "./api-token-scopes";

export interface AuthContext {
  user: User | null;
  sessionId?: string;
  authMethod?: "basic" | "jwt" | "apikey";
  apiKeyId?: string;
  scopes?: ApiKeyScope[];
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials extends LoginCredentials {
  confirmPassword: string;
}

export interface ApiKeyCreateRequest {
  name: string;
  expiresAt?: Date;
  scopes?: ApiKeyScope[];
}

export interface ApiKeyResponse {
  id: string;
  key: string;
  name: string;
  createdAt: Date;
  expiresAt?: Date;
  scopes?: ApiKeyScope[];
}
