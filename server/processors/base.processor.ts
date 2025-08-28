export interface ProcessedDocument {
  content: string;
  metadata: {
    fileName?: string;
    fileType?: string;
    pageCount?: number;
    [key: string]: any;
  };
}

export abstract class BaseProcessor {
  abstract supportedTypes: string[];
  abstract process(buffer: Buffer, fileName?: string): Promise<ProcessedDocument>;
  
  canProcess(fileType: string): boolean {
    return this.supportedTypes.includes(fileType.toLowerCase());
  }
}