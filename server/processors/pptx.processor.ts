import JSZip from "jszip";
import { parseString } from "xml2js";
import { promisify } from "util";
import { BaseProcessor } from "./base.processor";
import type { ProcessedDocument } from "./base.processor";
import { sanitizeContent } from "../utils/sanitize";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("pptx-processor");

const parseXml = promisify(parseString) as (xml: string) => Promise<unknown>;

/**
 * Narrows a parsed xml2js node to a plain object. xml2js represents elements as
 * objects whose values are arrays of child nodes; text content is either a plain
 * string or an object carrying it under the `_` key (with attributes under `$`).
 */
function isXmlObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class PptxProcessor extends BaseProcessor {
  supportedTypes = [
    "pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "ppt",
    "application/vnd.ms-powerpoint",
  ];

  async process(buffer: Buffer, fileName?: string): Promise<ProcessedDocument> {
    try {
      if (this.isLegacyPpt(fileName, buffer)) {
        return this.processLegacyPpt(buffer, fileName);
      }

      return await this.processPptx(buffer, fileName);
    } catch (error) {
      logger.error({ err: error }, "Error processing PowerPoint file");
      return {
        content: "",
        metadata: {
          fileName,
          fileType: "pptx",
          error: "Failed to process PowerPoint file",
        },
      };
    }
  }

  private isLegacyPpt(fileName?: string, buffer?: Buffer): boolean {
    if (fileName?.toLowerCase().endsWith(".ppt")) {
      return true;
    }

    if (buffer && buffer.length > 8) {
      const signature = buffer.slice(0, 8).toString("hex");
      return signature.startsWith("d0cf11e0a1b11ae1");
    }

    return false;
  }

  private async processPptx(buffer: Buffer, fileName?: string): Promise<ProcessedDocument> {
    const zip = await JSZip.loadAsync(buffer);
    const slideTexts: string[] = [];
    const notesTexts: string[] = [];
    let slideCount = 0;

    const slideFiles = Object.keys(zip.files)
      .filter((name) => name.startsWith("ppt/slides/slide") && name.endsWith(".xml"))
      .sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)\.xml/)?.[1] || "0");
        const numB = parseInt(b.match(/slide(\d+)\.xml/)?.[1] || "0");
        return numA - numB;
      });

    slideCount = slideFiles.length;

    for (const slideName of slideFiles) {
      const slideContent = await zip.files[slideName].async("string");
      const slideText = await this.extractTextFromXml(slideContent);
      if (slideText) {
        slideTexts.push(slideText);
      }

      const slideNumber = slideName.match(/slide(\d+)\.xml/)?.[1];
      if (slideNumber) {
        const notesName = `ppt/notesSlides/notesSlide${slideNumber}.xml`;
        if (zip.files[notesName]) {
          const notesContent = await zip.files[notesName].async("string");
          const notesText = await this.extractTextFromXml(notesContent);
          if (notesText) {
            notesTexts.push(notesText);
          }
        }
      }
    }

    const titleContent = await this.extractTitle(zip);
    const metadata = await this.extractMetadata(zip);

    let content = "";
    if (titleContent) {
      content += `Title: ${titleContent}\n\n`;
    }

    content += slideTexts.join("\n\n---\n\n");

    if (notesTexts.length > 0) {
      content += "\n\n=== SPEAKER NOTES ===\n\n";
      content += notesTexts.join("\n\n---\n\n");
    }

    return {
      content: sanitizeContent(content),
      metadata: {
        fileName,
        fileType: "pptx",
        slideCount,
        ...metadata,
      },
    };
  }

  private processLegacyPpt(buffer: Buffer, fileName?: string): ProcessedDocument {
    const textParts: string[] = [];
    const bufferString = buffer.toString("binary");

    const textRegex = /[\x20-\x7E]{4,}/g;
    const matches = bufferString.match(textRegex);

    if (matches) {
      textParts.push(
        ...matches.filter((text) => {
          return (
            !text.includes("Microsoft") &&
            !text.includes("PowerPoint") &&
            !text.includes("Arial") &&
            !text.includes("Times") &&
            text.length > 10
          );
        }),
      );
    }

    return {
      content: sanitizeContent(textParts.join("\n")),
      metadata: {
        fileName,
        fileType: "ppt",
        warning: "Legacy PPT format - text extraction may be incomplete",
      },
    };
  }

  private async extractTextFromXml(xmlContent: string): Promise<string> {
    try {
      const result = await parseXml(xmlContent);
      const texts: string[] = [];

      this.extractTextRecursive(result, texts);

      return texts.join(" ").trim();
    } catch (error) {
      logger.error({ err: error }, "Error parsing XML");
      return "";
    }
  }

  private extractTextRecursive(obj: unknown, texts: string[]): void {
    if (typeof obj === "string") {
      texts.push(obj);
      return;
    }

    if (isXmlObject(obj)) {
      const textNode = obj["a:t"];
      if (textNode) {
        if (Array.isArray(textNode)) {
          for (const entry of textNode) {
            if (typeof entry === "string") {
              texts.push(entry);
            }
          }
        } else if (typeof textNode === "string") {
          texts.push(textNode);
        } else if (isXmlObject(textNode) && typeof textNode["_"] === "string") {
          texts.push(textNode["_"]);
        }
      }

      for (const key in obj) {
        if (key !== "a:t" && Object.prototype.hasOwnProperty.call(obj, key)) {
          const value = obj[key];
          if (Array.isArray(value)) {
            value.forEach((item) => this.extractTextRecursive(item, texts));
          } else if (typeof value === "object" && value !== null) {
            this.extractTextRecursive(value, texts);
          }
        }
      }
    }
  }

  private async extractTitle(zip: JSZip): Promise<string | null> {
    try {
      if (zip.files["docProps/core.xml"]) {
        const coreContent = await zip.files["docProps/core.xml"].async("string");
        const result = await parseXml(coreContent);

        if (isXmlObject(result)) {
          const coreProps = result["cp:coreProperties"];
          if (isXmlObject(coreProps)) {
            const title = coreProps["dc:title"];
            if (title) {
              const value = Array.isArray(title) ? title[0] : title;
              if (typeof value === "string") {
                return value;
              }
            }
          }
        }
      }

      const slide1 = zip.files["ppt/slides/slide1.xml"];
      if (slide1) {
        const slideContent = await slide1.async("string");
        const result = await parseXml(slideContent);
        const texts: string[] = [];
        this.extractTextRecursive(result, texts);
        if (texts.length > 0) {
          return texts[0].substring(0, 100);
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Error extracting title");
    }

    return null;
  }

  private async extractMetadata(zip: JSZip): Promise<Record<string, string>> {
    const metadata: Record<string, string> = {};

    const readStringProp = (props: { [key: string]: unknown }, key: string): string | undefined => {
      const raw = props[key];
      const value = Array.isArray(raw) ? raw[0] : raw;
      return typeof value === "string" ? value : undefined;
    };

    try {
      if (zip.files["docProps/core.xml"]) {
        const coreContent = await zip.files["docProps/core.xml"].async("string");
        const result = await parseXml(coreContent);
        const props = isXmlObject(result) ? result["cp:coreProperties"] : undefined;

        if (isXmlObject(props)) {
          const author = readStringProp(props, "dc:creator");
          if (author !== undefined) {
            metadata.author = author;
          }
          const created = readStringProp(props, "dcterms:created");
          if (created !== undefined) {
            metadata.created = created;
          }
          const modified = readStringProp(props, "dcterms:modified");
          if (modified !== undefined) {
            metadata.modified = modified;
          }
        }
      }

      if (zip.files["docProps/app.xml"]) {
        const appContent = await zip.files["docProps/app.xml"].async("string");
        const result = await parseXml(appContent);
        const props = isXmlObject(result) ? result["Properties"] : undefined;

        if (isXmlObject(props)) {
          const application = readStringProp(props, "Application");
          if (application !== undefined) {
            metadata.application = application;
          }
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Error extracting metadata");
    }

    return metadata;
  }
}
