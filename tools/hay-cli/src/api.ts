/**
 * Minimal tRPC-over-HTTP client. The server uses no transformer, so queries are
 * GET `/v1/<path>?input=<json>` and mutations POST `/v1/<path>` with a JSON body;
 * responses are `{ result: { data } }` or `{ error: { message, data: { code } } }`.
 */
import type { TargetProfile } from "./config";

export class HayApiError extends Error {
  constructor(
    public path: string,
    public code: string,
    message: string,
    public httpStatus: number,
  ) {
    super(`${path}: ${code} ${message}`);
  }
}

interface TrpcEnvelope<T> {
  result?: { data: T };
  error?: { message?: string; data?: { code?: string; httpStatus?: number } };
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface Credentials {
  email: string;
  password: string;
}

export interface LoginResponse extends AuthTokens {
  user: {
    activeOrganizationId?: string;
    organizations: { id: string; name: string }[];
  };
}

export interface ApiOptions {
  profile: TargetProfile;
  /** Organization for `x-organization-id`; defaults to the profile's. */
  organizationId?: string;
  /** Called after a token refresh so the new pair is persisted. */
  onTokens?: (tokens: AuthTokens) => void;
  /** Used to log in when there is no session or the refresh token is rejected. */
  credentials?: Credentials;
  /** Called after a login so the session and its organization are persisted. */
  onLogin?: (email: string, response: LoginResponse, organizationId?: string) => void;
}

const USER_AGENT = "hay-cli/0.1";
const EXPIRY_MARGIN_SECONDS = 30;

/** Seconds until a JWT expires, or null when the token carries no readable `exp`. */
export function jwtSecondsLeft(token: string, nowMs: number = Date.now()): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: number;
    };
    return typeof exp === "number" ? exp - Math.floor(nowMs / 1000) : null;
  } catch {
    return null;
  }
}

export class HayApi {
  private profile: TargetProfile;
  private organizationId?: string;
  private onTokens?: (tokens: AuthTokens) => void;
  private credentials?: Credentials;
  private onLogin?: ApiOptions["onLogin"];

  constructor(options: ApiOptions) {
    this.profile = { ...options.profile };
    this.organizationId = options.organizationId ?? options.profile.organizationId;
    this.onTokens = options.onTokens;
    this.credentials = options.credentials;
    this.onLogin = options.onLogin;
  }

  get baseUrl(): string {
    return this.profile.baseUrl.replace(/\/$/, "");
  }

  get hasAuth(): boolean {
    return !!(
      this.profile.apiKey ||
      this.profile.refreshToken ||
      this.profile.accessToken ||
      this.credentials
    );
  }

  /** `auth.login`; keeps the new tokens and, without an explicit org, adopts the user's active one. */
  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await this.call<LoginResponse>(
      "POST",
      "auth.login",
      { email, password },
      false,
      true,
    );
    this.profile.accessToken = response.accessToken;
    this.profile.refreshToken = response.refreshToken;
    this.organizationId ??= response.user.activeOrganizationId;
    this.onLogin?.(email, response, this.organizationId);
    return response;
  }

  query<T>(path: string, input?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
    return this.call<T>("GET", path, input, opts.auth ?? true);
  }

  mutation<T>(path: string, input?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
    return this.call<T>("POST", path, input, opts.auth ?? true);
  }

  private async call<T>(
    method: "GET" | "POST",
    path: string,
    input: unknown,
    auth: boolean,
    retried = false,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      // Public widget endpoints check Origin against the dashboard host / allowed domains.
      Origin: this.baseUrl,
    };
    if (auth) {
      headers.Authorization = `Bearer ${await this.bearer()}`;
      if (this.organizationId) headers["x-organization-id"] = this.organizationId;
    }

    let url = `${this.baseUrl}/v1/${path}`;
    let body: string | undefined;
    if (method === "GET") {
      if (input !== undefined) url += `?input=${encodeURIComponent(JSON.stringify(input))}`;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(input ?? {});
    }

    let response: Response;
    try {
      response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(60_000) });
    } catch (error) {
      throw new HayApiError(path, "NETWORK", (error as Error).message, 0);
    }

    const text = await response.text();
    let envelope: TrpcEnvelope<T>;
    try {
      envelope = JSON.parse(text) as TrpcEnvelope<T>;
    } catch {
      throw new HayApiError(path, "BAD_RESPONSE", text.slice(0, 200), response.status);
    }

    if (envelope.error || !response.ok) {
      const code = envelope.error?.data?.code ?? `HTTP_${response.status}`;
      const message = envelope.error?.message ?? response.statusText;
      if (auth && !retried && code === "UNAUTHORIZED" && this.canRefresh()) {
        await this.refresh();
        return this.call<T>(method, path, input, auth, true);
      }
      throw new HayApiError(path, code, message, response.status);
    }
    return envelope.result!.data;
  }

  private canRefresh(): boolean {
    return !this.profile.apiKey && !!this.profile.refreshToken;
  }

  private async bearer(): Promise<string> {
    if (this.profile.apiKey) return this.profile.apiKey;
    const access = this.profile.accessToken;
    const left = access ? jwtSecondsLeft(access) : null;
    if (access && (left === null || left > EXPIRY_MARGIN_SECONDS)) return access;
    if (this.canRefresh()) {
      await this.refresh();
      return this.profile.accessToken!;
    }
    if (this.credentials) {
      await this.login(this.credentials.email, this.credentials.password);
      return this.profile.accessToken!;
    }
    throw new HayApiError("auth", "NOT_LOGGED_IN", "run `hay login` first", 401);
  }

  private async refresh(): Promise<void> {
    try {
      await this.refreshTokens();
    } catch (error) {
      if (!(error instanceof HayApiError && error.code === "SESSION_ENDED" && this.credentials)) {
        throw error;
      }
      await this.login(this.credentials.email, this.credentials.password);
    }
  }

  private async refreshTokens(): Promise<void> {
    const tokens = await this.call<AuthTokens>(
      "POST",
      "auth.refreshToken",
      { refreshToken: this.profile.refreshToken },
      false,
      true,
    ).catch((error: unknown) => {
      if (error instanceof HayApiError && error.code === "UNAUTHORIZED") {
        throw new HayApiError("auth", "SESSION_ENDED", "refresh rejected, run `hay login`", 401);
      }
      throw error;
    });
    this.profile.accessToken = tokens.accessToken;
    this.profile.refreshToken = tokens.refreshToken;
    this.onTokens?.(tokens);
  }
}
