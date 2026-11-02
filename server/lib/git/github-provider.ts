import jwt from "jsonwebtoken";
import { config } from "@server/config/env";
import { createLogger } from "@server/lib/logger";
import type {
  GitProvider,
  GitRepoInfo,
  GitArchiveResult,
  GitLatestCommit,
} from "./git-provider.interface";

const logger = createLogger("github-provider");

const GITHUB_API_BASE = "https://api.github.com";
const API_TIMEOUT_MS = 15_000;
// Covers streaming the whole archive body, not just the response headers
const ARCHIVE_TIMEOUT_MS = 120_000;

/** Read a response body into memory, failing as soon as it exceeds `maxBytes`. */
export async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const tooLarge = () => new Error(`Archive exceeds maximum size (${maxBytes} bytes)`);

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw tooLarge();
  }
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export class GitHubProvider implements GitProvider {
  readonly id = "github";

  /**
   * Generate a JWT signed with the GitHub App private key.
   * Used to authenticate as the app itself (not an installation).
   */
  private generateAppJwt(): string {
    const { appId, appPrivateKey } = config.github;

    if (!appId || !appPrivateKey) {
      throw new Error(
        "GitHub App not configured: GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required",
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60, // Issued 60s in the past to account for clock drift
      exp: now + 600, // 10 minute expiry (GitHub max)
      iss: appId,
    };

    return jwt.sign(payload, appPrivateKey, { algorithm: "RS256" });
  }

  /**
   * Exchange the App JWT for a short-lived installation access token.
   * Tokens are valid for 1 hour.
   */
  async getAccessToken(installationId: string): Promise<string> {
    const appJwt = this.generateAppJwt();

    const response = await fetch(
      `${GITHUB_API_BASE}/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, error: errorText, installationId },
        "Failed to get installation token",
      );
      throw new Error(`GitHub installation token request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return data.token;
  }

  /**
   * Get details about a GitHub App installation.
   */
  async getInstallation(installationId: string): Promise<{
    account: { login: string; type: string };
    permissions: Record<string, string>;
    repositorySelection: string;
  }> {
    const appJwt = this.generateAppJwt();

    const response = await fetch(`${GITHUB_API_BASE}/app/installations/${installationId}`, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get installation details: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return {
      account: { login: data.account.login, type: data.account.type },
      permissions: data.permissions,
      repositorySelection: data.repository_selection,
    };
  }

  async listRepositories(installationId: string): Promise<GitRepoInfo[]> {
    const token = await this.getAccessToken(installationId);
    const repos: GitRepoInfo[] = [];
    let page = 1;

    // Paginate through all repos (100 per page)
    while (true) {
      const response = await fetch(
        `${GITHUB_API_BASE}/installation/repositories?per_page=100&page=${page}`,
        {
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to list repositories: ${response.status} ${errorText}`);
      }

      const data = await response.json();

      for (const repo of data.repositories) {
        repos.push({
          fullName: repo.full_name,
          name: repo.name,
          private: repo.private,
          defaultBranch: repo.default_branch,
          description: repo.description || undefined,
          htmlUrl: repo.html_url,
        });
      }

      if (repos.length >= data.total_count) {
        break;
      }

      page++;
    }

    return repos;
  }

  async downloadArchive(
    installationId: string,
    repo: string,
    commitSha: string,
    maxBytes: number,
  ): Promise<GitArchiveResult> {
    const token = await this.getAccessToken(installationId);

    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${repo}/tarball/${encodeURIComponent(commitSha)}`,
      {
        signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        redirect: "follow",
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to download archive for ${repo}@${commitSha}: ${response.status} ${errorText}`,
      );
    }

    const buffer = await readBodyWithLimit(response, maxBytes);

    logger.info({ repo, commitSha, sizeBytes: buffer.length }, "Downloaded archive");

    return {
      buffer,
      commitSha,
    };
  }

  async getLatestCommit(
    installationId: string,
    repo: string,
    branch: string,
  ): Promise<GitLatestCommit> {
    const token = await this.getAccessToken(installationId);

    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${repo}/commits/${encodeURIComponent(branch)}`,
      {
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to get latest commit for ${repo}@${branch}: ${response.status} ${errorText}`,
      );
    }

    const data = await response.json();

    return {
      sha: data.sha,
      message: data.commit.message,
      date: data.commit.committer.date,
      author: data.commit.author.name,
    };
  }
}

export const githubProvider = new GitHubProvider();
