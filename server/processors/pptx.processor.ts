import JSZip from "jszip";
import { parseString } from "xml2js";
import { promisify } from "util";
import { BaseProcessor } from "./base.processor";
import type { ProcessedDocument } from "./base.processor";
import { sanitizeContent } from "../utils/sanitize";

const parseXml = promisify(parseString);

export class PptxProcessor extends BaseProcessor {
  supportedTypes = [
    "pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "ppt",
    "application/vnd.ms-powerpoint"
  ];

  async process(buffer: Buffer, fileName?: string): Promise<ProcessedDocument> {
    try {
      if (this.isLegacyPpt(fileName, buffer)) {
        return this.processLegacyPpt(buffer, fileName);
      }
      
      return await this.processPptx(buffer, fileName);
    } catch (error) {
      console.error("Error processing PowerPoint file:", error);
      return {
        content: "",
        metadata: {
          fileName,
          fileType: "pptx",
          error: "Failed to process PowerPoint file"
        }
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
      .filter(name => name.startsWith("ppt/slides/slide") && name.endsWith(".xml"))
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
        ...metadata
      }
    };
  }

  private processLegacyPpt(buffer: Buffer, fileName?: string): ProcessedDocument {
    const textParts: string[] = [];
    const bufferString = buffer.toString("binary");
    
    const textRegex = /[\x20-\x7E]{4,}/g;
    const matches = bufferString.match(textRegex);
    
    if (matches) {
      textParts.push(...matches.filter(text => {
        return !text.includes("Microsoft") && 
               !text.includes("PowerPoint") &&
               !text.includes("Arial") &&
               !text.includes("Times") &&
               text.length > 10;
      }));
    }

    return {
      content: sanitizeContent(textParts.join("\n")),
      metadata: {
        fileName,
        fileType: "ppt",
        warning: "Legacy PPT format - text extraction may be incomplete"
      }
    };
  }

  private async extractTextFromXml(xmlContent: string): Promise<string> {
    try {
      const result: any = await parseXml(xmlContent);
      const texts: string[] = [];
      
      this.extractTextRecursive(result, texts);
      
      return texts.join(" ").trim();
    } catch (error) {
      console.error("Error parsing XML:", error);
      return "";
    }
  }

  private extractTextRecursive(obj: any, texts: string[]): void {
    if (typeof obj === "string") {
      texts.push(obj);
      return;
    }

    if (obj && typeof obj === "object") {
      if (obj["a:t"]) {
        if (Array.isArray(obj["a:t"])) {
          texts.push(...obj["a:t"]);
        } else if (typeof obj["a:t"] === "string") {
          texts.push(obj["a:t"]);
        } else if (obj["a:t"]["_"]) {
          texts.push(obj["a:t"]["_"]);
        }
      }

      for (const key in obj) {
        if (key !== "a:t" && obj.hasOwnProperty(key)) {
          if (Array.isArray(obj[key])) {
            obj[key].forEach((item: any) => this.extractTextRecursive(item, texts));
          } else if (typeof obj[key] === "object") {
            this.extractTextRecursive(obj[key], texts);
          }
        }
      }
    }
  }

  private async extractTitle(zip: JSZip): Promise<string | null> {
    try {
      if (zip.files["docProps/core.xml"]) {
        const coreContent = await zip.files["docProps/core.xml"].async("string");
        const result: any = await parseXml(coreContent);
        
        if (result?.["cp:coreProperties"]?.["dc:title"]) {
          const title = result["cp:coreProperties"]["dc:title"];
          return Array.isArray(title) ? title[0] : title;
        }
      }

      const slide1 = zip.files["ppt/slides/slide1.xml"];
      if (slide1) {
        const slideContent = await slide1.async("string");
        const result: any = await parseXml(slideContent);
        const texts: string[] = [];
        this.extractTextRecursive(result, texts);
        if (texts.length > 0) {
          return texts[0].substring(0, 100);
        }
      }
    } catch (error) {
      console.error("Error extracting title:", error);
    }
    
    return null;
  }

  private async extractMetadata(zip: JSZip): Promise<Record<string, any>> {
    const metadata: Record<string, any> = {};
    
    try {
      if (zip.files["docProps/core.xml"]) {
        const coreContent = await zip.files["docProps/core.xml"].async("string");
        const result: any = await parseXml(coreContent);
        const props = result?.["cp:coreProperties"];
        
        if (props) {
          if (props["dc:creator"]) {
            metadata.author = Array.isArray(props["dc:creator"]) 
              ? props["dc:creator"][0] 
              : props["dc:creator"];
          }
          if (props["dcterms:created"]) {
            metadata.created = Array.isArray(props["dcterms:created"]) 
              ? props["dcterms:created"][0] 
              : props["dcterms:created"];
          }
          if (props["dcterms:modified"]) {
            metadata.modified = Array.isArray(props["dcterms:modified"]) 
              ? props["dcterms:modified"][0] 
              : props["dcterms:modified"];
          }
        }
      }

      if (zip.files["docProps/app.xml"]) {
        const appContent = await zip.files["docProps/app.xml"].async("string");
        const result: any = await parseXml(appContent);
        const props = result?.["Properties"];
        
        if (props) {
          if (props["Application"]) {
            metadata.application = Array.isArray(props["Application"]) 
              ? props["Application"][0] 
              : props["Application"];
          }
        }
      }
    } catch (error) {
      console.error("Error extracting metadata:", error);
    }
    
    return metadata;
  }
}