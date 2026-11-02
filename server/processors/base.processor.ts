/** A document refused for its type, size or the resources parsing it needs. */
export class DocumentRejectedError extends Error {}

export interface ProcessedDocument {
  content: string;
  metadata: {
    fileName?: string;
    fileType?: string;
    pageCount?: number;
    [key: string]: unknown;
  };
}

export abstract class BaseProcessor {
  abstract supportedTypes: string[];
  abstract process(buffer: Buffer, fileName?: string): Promise<ProcessedDocument>;

  canProcess(fileType: string): boolean {
    return this.supportedTypes.includes(fileType.toLowerCase());
  }
}
