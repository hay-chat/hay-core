import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload as S3Upload } from "@aws-sdk/lib-storage";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config/env";
import { Upload } from "../entities/upload.entity";

// Allowed file types
const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  // Images
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "image/svg+xml": [".svg"],
  "image/bmp": [".bmp"],
  "image/tiff": [".tiff", ".tif"],

  // Documents
  "application/pdf": [".pdf"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-powerpoint": [".ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "text/csv": [".csv"],
  "text/plain": [".txt"],
  "application/rtf": [".rtf"],
  "application/vnd.oasis.opendocument.text": [".odt"],
  "application/vnd.oasis.opendocument.spreadsheet": [".ods"],
  "application/vnd.oasis.opendocument.presentation": [".odp"],

  // Archives
  "application/zip": [".zip"],
  "application/x-zip-compressed": [".zip"],
};

export interface UploadOptions {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  folder: string;
  organizationId: string;
  uploadedById?: string;
  maxSize?: number;
}

export interface UploadResult {
  upload: Upload;
  url: string;
}

export class StorageService {
  private s3Client?: S3Client;

  constructor() {
    if (this.isS3Configured()) {
      // Extract regional endpoint from bucket-specific endpoint if needed
      const endpoint = this.getS3ClientEndpoint();

      this.s3Client = new S3Client({
        endpoint,
        region: config.storage.s3.region!,
        credentials: {
          accessKeyId: config.storage.s3.accessKeyId!,
          secretAccessKey: config.storage.s3.secretAccessKey!,
        },
        forcePathStyle: false, // Use virtual-hosted-style URLs
      });
    }
  }

  /**
   * Get S3 client endpoint (regional endpoint without bucket name)
   */
  private getS3ClientEndpoint(): string {
    const endpoint = config.storage.s3.endpoint!;
    const bucket = config.storage.s3.bucket!;

    // If endpoint includes bucket name (e.g., https://bucket.region.digitaloceanspaces.com)
    // extract the regional endpoint (e.g., https://region.digitaloceanspaces.com)
    if (endpoint.includes(`${bucket}.`)) {
      return endpoint.replace(`${bucket}.`, "");
    }

    return endpoint;
  }

  /**
   * Main upload function
   * Files are stored in structure: {organizationId}/{folder}/{uuid}.{ext}
   *
   * Local storage: files stored at {uploadDir}/{orgId}/{folder}/{uuid}.{ext}
   *                served at /uploads/{orgId}/{folder}/{uuid}.{ext}
   * S3 storage:    files stored at key {orgId}/{folder}/{uuid}.{ext}
   *                URL: {endpoint}/{key}
   */
  async upload(options: UploadOptions): Promise<UploadResult> {
    // 1. Validate file
    this.validateFile(options.mimeType, options.buffer.length, options.maxSize);

    // 2. Generate filename (UUID + extension only)
    const filename = this.generateFilename(options.originalName);

    // 3. Build path: {orgId}/{folder}/{filename}
    // Note: The "uploads/" prefix comes from the serving route (local) or bucket structure (S3)
    const filePath = `${options.organizationId}/${options.folder}/${filename}`;

    // 4. Detect storage type
    const storageType = this.getStorageType();

    // 5. Upload to storage
    if (storageType === "s3") {
      await this.uploadS3(options.buffer, filePath, options.mimeType);
    } else {
      await this.uploadLocal(options.buffer, filePath);
    }

    // 6. Create database record
    const upload = await Upload.create({
      filename,
      originalName: options.originalName,
      path: filePath,
      mimeType: options.mimeType,
      size: options.buffer.length,
      storageType,
      folder: options.folder,
      organizationId: options.organizationId,
      uploadedById: options.uploadedById,
    }).save();

    // 7. Generate public URL
    const url = this.getPublicUrl(upload);

    return { upload, url };
  }

  /**
   * Download file from storage and return buffer
   */
  async download(uploadId: string): Promise<{ buffer: Buffer; upload: Upload }> {
    // 1. Fetch upload record
    const upload = await Upload.findOne({ where: { id: uploadId } });
    if (!upload) {
      throw new Error(`Upload not found: ${uploadId}`);
    }

    // 2. Download from storage
    let buffer: Buffer;
    if (upload.storageType === "s3") {
      buffer = await this.downloadS3(upload.path);
    } else {
      buffer = await this.downloadLocal(upload.path);
    }

    return { buffer, upload };
  }

  /**
   * Delete file from storage and database
   */
  async delete(uploadId: string): Promise<void> {
    // 1. Fetch upload record
    const upload = await Upload.findOne({ where: { id: uploadId } });
    if (!upload) return;

    // 2. Delete from storage
    if (upload.storageType === "s3") {
      await this.deleteS3(upload.path);
    } else {
      await this.deleteLocal(upload.path);
    }

    // 3. Delete database record
    await upload.remove();
  }

  /**
   * Specialized upload for plugin ZIP files
   * Final path: {orgId}/plugin-zips/{pluginId}/{uuid}.zip
   * Served at: /uploads/{orgId}/plugin-zips/{pluginId}/{uuid}.zip
   */
  async uploadPluginZip(options: {
    buffer: Buffer;
    originalName: string;
    pluginId: string;
    organizationId: string;
    uploadedById: string;
    maxSize?: number;
  }): Promise<UploadResult> {
    const maxSize = options.maxSize || config.plugins.maxUploadSizeMB * 1024 * 1024;

    // Validate ZIP
    this.validateFile("application/zip", options.buffer.length, maxSize);

    // Folder structure: plugin-zips/{pluginId}
    // Final path: {orgId}/plugin-zips/{pluginId}/{uuid}.zip
    const folder = `plugin-zips/${options.pluginId}`;

    // Upload ZIP
    return await this.upload({
      buffer: options.buffer,
      originalName: options.originalName,
      mimeType: "application/zip",
      folder,
      organizationId: options.organizationId,
      uploadedById: options.uploadedById,
      maxSize,
    });
  }

  /**
   * Get public URL from upload record
   */
  getPublicUrl(upload: Upload): string {
    if (upload.storageType === "s3") {
      // S3 URL
      const endpoint = config.storage.s3.endpoint!;
      const bucket = config.storage.s3.bucket!;

      // Handle different endpoint formats
      if (endpoint.includes(bucket)) {
        return `${endpoint}/${upload.path}`;
      } else {
        return `${endpoint}/${bucket}/${upload.path}`;
      }
    } else {
      // Local URL
      return `${config.storage.local.baseUrl}/${upload.path}`;
    }
  }

  /**
   * Check if S3 is configured
   */
  private isS3Configured(): boolean {
    const { endpoint, region, bucket, accessKeyId, secretAccessKey } = config.storage.s3;
    return !!(endpoint && region && bucket && accessKeyId && secretAccessKey);
  }

  /**
   * Get storage type (auto-detect)
   */
  private getStorageType(): "local" | "s3" {
    return this.isS3Configured() ? "s3" : "local";
  }

  /**
   * Validate file
   */
  private validateFile(mimeType: string, size: number, maxSize?: number): void {
    // Check MIME type
    if (!ALLOWED_MIME_TYPES[mimeType]) {
      throw new Error(
        `File type not allowed: ${mimeType}. Allowed types: ${Object.keys(ALLOWED_MIME_TYPES).join(", ")}`
      );
    }

    // Check size
    const sizeLimit = maxSize || config.storage.limits.maxFileSize;
    if (size > sizeLimit) {
      const maxSizeMB = (sizeLimit / (1024 * 1024)).toFixed(2);
      const fileSizeMB = (size / (1024 * 1024)).toFixed(2);
      throw new Error(`File too large: ${fileSizeMB}MB. Maximum allowed: ${maxSizeMB}MB`);
    }
  }

  /**
   * Generate unique filename using UUID only
   * Format: {uuid}.{ext}
   */
  private generateFilename(originalName: string): string {
    // Extract extension from original filename
    const ext = path.extname(originalName).toLowerCase();

    // Generate filename with UUID only
    return `${uuidv4()}${ext}`;
  }

  /**
   * Upload to local storage
   */
  private async uploadLocal(buffer: Buffer, filePath: string): Promise<void> {
    const fullPath = path.join(config.storage.local.uploadDir, filePath);
    const directory = path.dirname(fullPath);

    // Create directory if it doesn't exist
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    // Write file
    await fs.promises.writeFile(fullPath, buffer);
  }

  /**
   * Upload to S3
   */
  private async uploadS3(buffer: Buffer, filePath: string, mimeType: string): Promise<void> {
    if (!this.s3Client) {
      throw new Error("S3 client not initialized");
    }

    const upload = new S3Upload({
      client: this.s3Client,
      params: {
        Bucket: config.storage.s3.bucket!,
        Key: filePath,
        Body: buffer,
        ContentType: mimeType,
        ACL: "public-read", // Make files publicly accessible
      },
    });

    await upload.done();
  }

  /**
   * Download from local storage
   */
  private async downloadLocal(filePath: string): Promise<Buffer> {
    const fullPath = path.join(config.storage.local.uploadDir, filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    return await fs.promises.readFile(fullPath);
  }

  /**
   * Download from S3
   */
  private async downloadS3(filePath: string): Promise<Buffer> {
    if (!this.s3Client) {
      throw new Error("S3 client not initialized");
    }

    const { GetObjectCommand } = await import("@aws-sdk/client-s3");

    const command = new GetObjectCommand({
      Bucket: config.storage.s3.bucket!,
      Key: filePath,
    });

    const response = await this.s3Client.send(command);

    if (!response.Body) {
      throw new Error(`Failed to download file from S3: ${filePath}`);
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Delete from local storage
   */
  private async deleteLocal(filePath: string): Promise<void> {
    const fullPath = path.join(config.storage.local.uploadDir, filePath);

    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
    }
  }

  /**
   * Delete from S3
   */
  private async deleteS3(filePath: string): Promise<void> {
    if (!this.s3Client) {
      throw new Error("S3 client not initialized");
    }

    const command = new DeleteObjectCommand({
      Bucket: config.storage.s3.bucket!,
      Key: filePath,
    });

    await this.s3Client.send(command);
  }
}

export const storageService = new StorageService();
