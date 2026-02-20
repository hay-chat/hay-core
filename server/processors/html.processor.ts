import { BaseProcessor } from "./base.processor";
import type { ProcessedDocument } from "./base.processor";
import { sanitizeContent } from "../utils/sanitize";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

export class HtmlProcessor extends BaseProcessor {
  supportedTypes = ["text/html", "application/xhtml+xml"];
  private turndown: TurndownService;

  constructor() {
    super();
    this.turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      hr: "---",
    });

    // Only keep images that point to actual URLs (http/https or protocol-relative //)
    this.turndown.addRule("removeNonUrlImages", {
      filter: (node) => {
        if (node.nodeName !== "IMG") return false;
        const src = node.getAttribute("src") || "";
        return !src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("//");
      },
      replacement: () => "",
    });
  }

  /**
   * Strip img tags whose src is not an HTTP(S) URL.
   * Removes inline base64 data URIs, relative paths, and other non-URL sources
   * that are useless for text embeddings and can be hundreds of KB each.
   */
  private stripNonUrlImages(html: string): string {
    return html.replace(/<img\b[^>]*>/gi, (match) => {
      const srcMatch = match.match(/\bsrc\s*=\s*["']([^"']*?)["']/i);
      if (!srcMatch) return "";
      const src = srcMatch[1];
      // Keep http://, https://, and protocol-relative // URLs
      if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("//")) {
        return match;
      }
      return "";
    });
  }

  async process(buffer: Buffer, fileName?: string): Promise<ProcessedDocument> {
    const htmlContent = this.stripNonUrlImages(buffer.toString("utf-8"));

    try {
      // Use Readability (Firefox Reader Mode algorithm) to extract article content
      const markdownContent = this.convertToMarkdown(htmlContent);

      return {
        content: sanitizeContent(markdownContent),
        metadata: {
          fileName: fileName || "web-content.html",
          fileType: "text/html",
          originalLength: htmlContent.length,
          processedLength: markdownContent.length,
          processingMethod: "readability-turndown",
        },
      };
    } catch (error) {
      console.error("Failed to convert HTML with Readability + Turndown:", error);

      // Fallback to basic text extraction
      const textContent = this.extractTextFromHtml(htmlContent);
      return {
        content: sanitizeContent(textContent),
        metadata: {
          fileName: fileName || "web-content.html",
          fileType: "text/html",
          originalLength: htmlContent.length,
          processedLength: textContent.length,
          processingMethod: "text-extraction",
        },
      };
    }
  }

  private extractTextFromHtml(html: string): string {
    // Remove script and style elements
    let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, " ");

    // Decode HTML entities
    text = text.replace(/&nbsp;/g, " ");
    text = text.replace(/&amp;/g, "&");
    text = text.replace(/&lt;/g, "<");
    text = text.replace(/&gt;/g, ">");
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#039;/g, "'");

    // Clean up whitespace
    text = text.replace(/\s+/g, " ").trim();

    return text;
  }

  private convertToMarkdown(html: string): string {
    // Parse HTML into a DOM using linkedom
    const { document } = parseHTML(html);

    // Use Readability to extract article content (same as Firefox Reader Mode)
    const reader = new Readability(document);
    const article = reader.parse();

    if (!article || !article.content) {
      throw new Error("Readability could not extract article content");
    }

    // Convert the clean HTML to Markdown using Turndown
    let markdown = this.turndown.turndown(article.content);

    if (!markdown.trim()) {
      throw new Error("Turndown produced empty markdown");
    }

    // Clean up Turndown artifacts: lone asterisks from empty bold/em/decorative elements
    markdown = markdown.replace(/^\*{1,2}$/gm, "");

    return markdown;
  }
}
