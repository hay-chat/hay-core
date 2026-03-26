export interface GitRepoInfo {
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  description?: string;
  htmlUrl: string;
}

export interface GitArchiveResult {
  buffer: Buffer;
  commitSha: string;
}

export interface GitLatestCommit {
  sha: string;
  message: string;
  date: string;
  author: string;
}

export interface GitProvider {
  readonly id: string;

  /**
   * Get an access token for API calls.
   * For GitHub: generates installation token from App JWT + installationId.
   */
  getAccessToken(installationId: string): Promise<string>;

  /**
   * List repositories accessible to this installation.
   */
  listRepositories(installationId: string): Promise<GitRepoInfo[]>;

  /**
   * Download repository archive for a specific branch.
   */
  downloadArchive(installationId: string, repo: string, branch: string): Promise<GitArchiveResult>;

  /**
   * Get the latest commit on a branch (for change detection).
   */
  getLatestCommit(installationId: string, repo: string, branch: string): Promise<GitLatestCommit>;
}
