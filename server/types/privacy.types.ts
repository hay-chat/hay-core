/**
 * Type definitions for GDPR privacy data exports
 * Used in privacy.service.ts for type-safe export data structures
 */

export interface MessageAttachment {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
}

export interface MessageData {
  id: string;
  content: string;
  sender: string;
  created_at: Date;
  metadata: Record<string, unknown> | null;
  sentiment?: string | null;
  intent?: string | null;
  attachments?: MessageAttachment[];
}

export interface ConversationData {
  id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
  messages: MessageData[];
}

export interface EmbeddingData {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt?: Date;
  source: "conversation" | "message";
}

export interface ExportStatistics {
  totalConversations: number;
  totalMessages: number;
  totalAttachments: number;
  totalEmbeddings: number;
  totalDocuments?: number;
  totalUploads?: number;
  totalAuditLogs?: number;
}

export interface CustomerExportData {
  exportDate: string;
  exportVersion: string;
  dataSubject: {
    customerId: string;
    organizationId: string;
  };
  personalData: {
    profile: {
      externalId: string | null;
      email: string | null;
      phone: string | null;
      name: string | null;
      notes: string | null;
      externalMetadata: Record<string, unknown> | null;
      createdAt: Date;
      updatedAt: Date;
    };
    conversations: ConversationData[];
    embeddings: EmbeddingData[];
    statistics: ExportStatistics;
  };
}

export interface UserExportData {
  exportDate: string;
  exportVersion: string;
  dataSubject: {
    email: string;
    userId: string;
  };
  personalData: {
    profile: {
      email: string;
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      avatarUrl: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
    organizations: Array<{
      id: string;
      name: string;
      role: string;
      permissions: string[];
      joinedAt: Date;
    }>;
    apiKeys: Array<{
      id: string;
      name: string;
      createdAt: Date;
      lastUsedAt: Date | null;
    }>;
    auditLogs: Array<{
      id: string;
      action: string;
      resource: string;
      resourceId: string | null;
      createdAt: Date;
      metadata: Record<string, unknown> | null;
    }>;
    documents: Array<{
      id: string;
      title: string;
      createdAt: Date;
      updatedAt: Date;
      metadata: Record<string, unknown> | null;
      attachments: MessageAttachment[];
    }>;
    uploads: Array<{
      id: string;
      filename: string;
      originalName: string;
      path: string;
      mimeType: string;
      size: number;
      folder: string;
      createdAt: Date;
    }>;
    statistics: ExportStatistics;
  };
}

/**
 * Result statistics for attachment file deletion operations
 * Used during GDPR customer erasure
 */
export interface AttachmentDeletionResult {
  deleted: number;
  failed: number;
  errors: Array<{
    messageId: string;
    attachmentId: string;
    error: string;
  }>;
}
