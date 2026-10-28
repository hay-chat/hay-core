/**
 * Run a test conversation against a playbook version that is not live (D7-5).
 *
 * `conversation.metadata.playbookVersionOverride` names a playbook and one of
 * its versions (usually the draft). While it is set, that playbook is offered
 * to the selector even when it was never published, and when it is picked its
 * instructions come from the named version instead of the active one.
 *
 * Only test conversations (playground, simulation runs) honour it: a real
 * shopper never gets a draft, whatever ends up in the metadata.
 */

import { isTestConversation } from "./close-classification/outcome-rules";

type Metadata = Record<string, unknown> | null | undefined;

export const PLAYBOOK_VERSION_OVERRIDE_KEY = "playbookVersionOverride";

export interface PlaybookVersionOverride {
  playbookId: string;
  versionId: string;
}

/** The override this conversation runs with, or null. */
export function getPlaybookVersionOverride(metadata: Metadata): PlaybookVersionOverride | null {
  if (!isTestConversation(metadata)) return null;
  const value = metadata?.[PLAYBOOK_VERSION_OVERRIDE_KEY];
  if (!value || typeof value !== "object") return null;
  const { playbookId, versionId } = value as Record<string, unknown>;
  if (typeof playbookId !== "string" || typeof versionId !== "string") return null;
  return { playbookId, versionId };
}

/**
 * The playbooks the selector chooses from: the live ones, plus the overridden
 * playbook when it is not live yet (a new playbook whose first draft is tested).
 */
export async function withOverridePlaybook<T extends { id: string }>(
  metadata: Metadata,
  organizationId: string,
  livePlaybooks: T[],
  loadPlaybook: (playbookId: string, organizationId: string) => Promise<T | null>,
): Promise<T[]> {
  const override = getPlaybookVersionOverride(metadata);
  if (!override || livePlaybooks.some((p) => p.id === override.playbookId)) return livePlaybooks;
  const playbook = await loadPlaybook(override.playbookId, organizationId);
  return playbook ? [...livePlaybooks, playbook] : livePlaybooks;
}
