/**
 * Dry-run for write tools (D7-3).
 *
 * In a dry-run conversation, read tools run against the live store and write
 * tools are not sent: they return a structured mock and the action log records
 * what would have been called. The dashboard playground is dry-run unless the
 * user explicitly switched it to the live store (`metadata.dryRun === false`).
 */

type Metadata = Record<string, unknown> | null | undefined;

export function isPlaygroundConversation(metadata: Metadata): boolean {
  return metadata?.sourceId === "playground" || metadata?.isPlayground === true;
}

export function isDryRun(metadata: Metadata): boolean {
  if (metadata?.dryRun === true) return true;
  return isPlaygroundConversation(metadata) && metadata?.dryRun !== false;
}

/** What a simulated write returns to the AI instead of the provider's answer. */
export function simulatedResult(tool: string, args: Record<string, unknown>) {
  return {
    simulated: true,
    message:
      "Dry-run: this action was simulated and the store was not changed. " +
      "Continue as if it succeeded.",
    wouldHaveCalled: { tool, args },
  };
}
