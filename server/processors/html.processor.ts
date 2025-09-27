import { BaseProcessor } from "./base.processor";
import type { ProcessedDocument } from "./base.processor";
import OpenAI from "openai";
import { sanitizeContent } from "../utils/sanitize";

export class HtmlProcessor extends BaseProcessor {
  supportedTypes = ["text/html", "application/xhtml+xml"];
  private openai: OpenAI;

  constructor() {
    super();
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async process(buffer: Buffer, fileName?: string): Promise<ProcessedDocument> {
    const htmlContent = buffer.toString("utf-8");

    // Extract basic text content first (fallback)
    const textContent = this.extractTextFromHtml(htmlContent);

    try {
      // Use LLM to convert HTML to clean markdown
      const markdownContent = await this.convertToMarkdown(htmlContent);

      return {
        content: sanitizeContent(markdownContent),
        metadata: {
          fileName: fileName || "web-content.html",
          fileType: "text/html",
          originalLength: htmlContent.length,
          processedLength: markdownContent.length,
          processingMethod: "llm-markdown-conversion",
        },
      };
    } catch (error) {
      console.error("Failed to convert HTML to markdown with LLM:", error);

      // Fallback to basic text extraction
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

  private async convertToMarkdown(html: string): Promise<string> {
    // Truncate HTML if too long for LLM context
    const maxLength = 30000;
    const truncatedHtml = html.length > maxLength ? html.substring(0, maxLength) + "..." : html;

    const response = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a documentation converter. Convert the provided HTML content to clean, well-formatted Markdown. 
Focus on:
1. Preserving the main content and structure
2. Removing navigation, menus, footers, ads, and other non-content elements
3. Converting HTML formatting to proper Markdown syntax
4. Maintaining code blocks with proper language hints
5. Preserving links but simplifying them where appropriate
6. Creating a clean, readable document suitable for a knowledge base

Output only the Markdown content, no explanations.`,
        },
        {
          role: "user",
          content: truncatedHtml,
        },
      ],
      temperature: 0.3,
      max_tokens: 4000,
    });

    const markdownContent = response.choices[0]?.message?.content || "";

    if (!markdownContent) {
      throw new Error("LLM returned empty response");
    }

    return sanitizeContent(markdownContent);
  }
}
