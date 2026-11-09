// Mirrors the server enum, as the document pages do: TypeScript accepts it for the
// tRPC input only while the name and members match.
enum DocumentationStatus {
  DRAFT = "draft",
  PUBLISHED = "published",
  ARCHIVED = "archived",
  UNDER_REVIEW = "under_review",
  PROCESSING = "processing",
  ERROR = "error",
}

export type DocumentStatusUpdater = (input: {
  id: string;
  status: DocumentationStatus;
}) => Promise<unknown>;

// Archives (or restores) documents one by one so a single failure never hides the others.
// Restoring publishes the document again; the server keeps no pre-archive status.
export async function setDocumentsArchived(
  ids: string[],
  archived: boolean,
  update: DocumentStatusUpdater,
): Promise<{ succeeded: string[]; failed: string[] }> {
  const succeeded: string[] = [];
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await update({ id, status: archived ? DocumentationStatus.ARCHIVED : DocumentationStatus.PUBLISHED });
      succeeded.push(id);
    } catch (error) {
      console.error(`Error updating archive state of document ${id}:`, error);
      failed.push(id);
    }
  }
  return { succeeded, failed };
}
