/**
 * The lowest similarity at which a document chunk may reach the assistant. The chat and setup's
 * readiness check share it, so the board never calls ready what the chat cannot see. Weak matches
 * that get through are caught by the reply's grounding check, not by this floor.
 */
export const MIN_DOCUMENT_SIMILARITY = 0.25;
