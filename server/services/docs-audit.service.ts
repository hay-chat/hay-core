/**
 * Documentation Quality Audit Service
 *
 * Analyzes an organization's document collection across multiple quality dimensions.
 * Each dimension produces a score (0-100), findings, and recommendations.
 *
 * Phase 1 dimensions: Coverage & Gaps, Content Quality, Information Architecture
 * Phase 2 dimensions: Consistency, User Experience, Freshness, Readability
 *
 * @module services/docs-audit
 */

import { documentRepository } from "@server/repositories/document.repository";
import { jobRepository } from "@server/repositories/job.repository";
import { JobStatus } from "@server/entities/job.entity";
import { Document } from "@server/entities/document.entity";
import { LLMService } from "@server/services/core/llm.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("docs-audit");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Finding {
  type: "positive" | "negative" | "suggestion";
  title: string;
  detail: string;
  /** Affected document URLs or titles */
  affectedDocs?: string[];
}

export interface DimensionResult {
  dimension: string;
  score: number;
  weight: number;
  findings: Finding[];
  recommendations: string[];
}

export interface AuditResult {
  overallScore: number;
  dimensions: DimensionResult[];
  summary: string;
  documentCount: number;
  auditedAt: string;
}

// ─── Dimension Weights ───────────────────────────────────────────────────────

const DIMENSION_WEIGHTS = {
  coverage: 0.25,
  contentQuality: 0.25,
  informationArchitecture: 0.2,
  consistency: 0.1,
  userExperience: 0.08,
  freshness: 0.07,
  readability: 0.05,
};

// ─── Service ─────────────────────────────────────────────────────────────────

class DocsAuditService {
  private llm: LLMService;

  constructor() {
    this.llm = new LLMService();
  }

  /**
   * Run a full audit for an organization's documents.
   * Updates the job with progress and final results.
   */
  async runAudit(organizationId: string, jobId: string): Promise<AuditResult> {
    try {
      // Fetch all documents for the org
      const documents = await documentRepository.findByOrganization(organizationId);

      if (documents.length === 0) {
        const emptyResult: AuditResult = {
          overallScore: 0,
          dimensions: [],
          summary: "No documents found to analyze.",
          documentCount: 0,
          auditedAt: new Date().toISOString(),
        };
        await jobRepository.update(jobId, organizationId, {
          status: JobStatus.COMPLETED,
          result: emptyResult as unknown as Record<string, unknown>,
        });
        return emptyResult;
      }

      // Update job: analyzing
      await jobRepository.update(jobId, organizationId, {
        data: { stage: "analyzing", documentCount: documents.length },
      });

      // Run Phase 1 dimensions in parallel
      const [coverage, contentQuality, infoArch] = await Promise.all([
        this.analyzeCoverage(documents),
        this.analyzeContentQuality(documents),
        this.analyzeInformationArchitecture(documents),
      ]);

      const dimensions = [coverage, contentQuality, infoArch];

      // Calculate weighted overall score
      const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);
      const overallScore = Math.round(
        dimensions.reduce((sum, d) => sum + d.score * d.weight, 0) / totalWeight,
      );

      const result: AuditResult = {
        overallScore,
        dimensions,
        summary: this.generateSummary(overallScore, dimensions),
        documentCount: documents.length,
        auditedAt: new Date().toISOString(),
      };

      // Update job with results
      await jobRepository.update(jobId, organizationId, {
        status: JobStatus.COMPLETED,
        result: result as unknown as Record<string, unknown>,
      });

      logger.info(
        { organizationId, overallScore, documentCount: documents.length },
        "Audit completed",
      );
      return result;
    } catch (error) {
      logger.error({ organizationId, jobId, error }, "Audit failed");
      await jobRepository.update(jobId, organizationId, {
        status: JobStatus.FAILED,
        data: { error: error instanceof Error ? error.message : "Unknown error" },
      });
      throw error;
    }
  }

  // ─── Coverage & Gaps ─────────────────────────────────────────────────────

  async analyzeCoverage(documents: Document[]): Promise<DimensionResult> {
    const docSummaries = documents.map((d) => ({
      title: d.title || "Untitled",
      url: d.sourceUrl || "",
      snippet: (d.content || "").slice(0, 200),
      type: d.type,
    }));

    const prompt = `You are a documentation quality analyst. Analyze this set of documentation pages and evaluate coverage completeness.

Here are the ${documents.length} pages found:
${JSON.stringify(docSummaries, null, 2)}

Evaluate against these common documentation patterns:
- Getting Started / Quick Start guide
- Installation / Setup instructions
- API Reference / Technical Reference
- Tutorials / How-to guides
- FAQ / Troubleshooting
- Changelog / Release Notes
- Migration / Upgrade guides
- Configuration / Settings reference
- Architecture / Overview explanation
- Contributing guide
- Authentication / Security documentation
- Error handling / Status codes

Return a JSON response with this exact structure.`;

    const schema = {
      type: "object" as const,
      properties: {
        score: { type: "number" as const, description: "Coverage score 0-100" },
        presentCategories: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Documentation categories that ARE covered",
        },
        missingCategories: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Important documentation categories that are MISSING",
        },
        gaps: {
          type: "array" as const,
          items: {
            type: "object" as const,
            properties: {
              title: { type: "string" as const },
              detail: { type: "string" as const },
            },
            required: ["title", "detail"] as const,
            additionalProperties: false,
          },
          description: "Specific content gaps found",
        },
        recommendations: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Actionable recommendations to improve coverage",
        },
      },
      required: [
        "score",
        "presentCategories",
        "missingCategories",
        "gaps",
        "recommendations",
      ] as const,
      additionalProperties: false,
    };

    try {
      const responseText = await this.llm.invoke({
        prompt,
        jsonSchema: schema,
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 2000,
      });

      const response = JSON.parse(responseText as string);

      const findings: Finding[] = [
        ...response.presentCategories.map((cat: string) => ({
          type: "positive" as const,
          title: `${cat} documented`,
          detail: `Your documentation covers ${cat}.`,
        })),
        ...response.missingCategories.map((cat: string) => ({
          type: "negative" as const,
          title: `Missing: ${cat}`,
          detail: `No documentation found for ${cat}. This is a common documentation category that users expect.`,
        })),
        ...response.gaps.map((gap: { title: string; detail: string }) => ({
          type: "suggestion" as const,
          title: gap.title,
          detail: gap.detail,
        })),
      ];

      return {
        dimension: "Coverage & Gaps",
        score: Math.max(0, Math.min(100, response.score)),
        weight: DIMENSION_WEIGHTS.coverage,
        findings,
        recommendations: response.recommendations,
      };
    } catch (error) {
      logger.error({ error }, "Coverage analysis failed");
      return this.fallbackDimensionResult("Coverage & Gaps", DIMENSION_WEIGHTS.coverage);
    }
  }

  // ─── Content Quality ─────────────────────────────────────────────────────

  async analyzeContentQuality(documents: Document[]): Promise<DimensionResult> {
    const findings: Finding[] = [];
    let totalScore = 0;

    // Per-document heuristic analysis
    const docStats = documents.map((doc) => {
      const content = doc.content || "";
      const wordCount = content.split(/\s+/).filter(Boolean).length;
      const hasImages = /!\[.*?\]\(.*?\)/.test(content);
      const codeBlockCount = (content.match(/```/g) || []).length / 2;
      const headingCount = (content.match(/^#{1,6}\s/gm) || []).length;
      const hasLists = /^[\s]*[-*+]\s|^\s*\d+\.\s/m.test(content);
      const linkCount = (content.match(/\[.*?\]\(.*?\)/g) || []).length;

      return {
        title: doc.title || "Untitled",
        url: doc.sourceUrl || "",
        wordCount,
        hasImages,
        codeBlockCount: Math.floor(codeBlockCount),
        headingCount,
        hasLists,
        linkCount,
      };
    });

    // Aggregate statistics
    const avgWordCount = docStats.reduce((sum, d) => sum + d.wordCount, 0) / docStats.length;
    const docsWithImages = docStats.filter((d) => d.hasImages).length;
    const docsWithCode = docStats.filter((d) => d.codeBlockCount > 0).length;
    const docsWithHeadings = docStats.filter((d) => d.headingCount >= 2).length;
    const docsWithLists = docStats.filter((d) => d.hasLists).length;

    const imageRatio = docsWithImages / documents.length;
    const codeRatio = docsWithCode / documents.length;
    const headingRatio = docsWithHeadings / documents.length;
    const listRatio = docsWithLists / documents.length;

    // Score components (each 0-25, totaling 0-100)
    const structureScore = Math.min(25, headingRatio * 25 + (listRatio > 0.3 ? 5 : 0));
    const richnessScore = Math.min(25, imageRatio * 15 + codeRatio * 10);
    const depthScore = Math.min(25, avgWordCount >= 300 ? 25 : (avgWordCount / 300) * 25);
    const linkScore = Math.min(
      25,
      Math.min(docStats.reduce((sum, d) => sum + d.linkCount, 0) / documents.length / 3, 1) * 25,
    );

    totalScore = Math.round(structureScore + richnessScore + depthScore + linkScore);

    // Generate findings
    if (headingRatio >= 0.7) {
      findings.push({
        type: "positive",
        title: "Well-structured content",
        detail: `${Math.round(headingRatio * 100)}% of pages use proper headings for organization.`,
      });
    } else {
      findings.push({
        type: "negative",
        title: "Lacking structure",
        detail: `Only ${Math.round(headingRatio * 100)}% of pages use proper headings. Well-structured content is easier to scan.`,
      });
    }

    if (imageRatio >= 0.3) {
      findings.push({
        type: "positive",
        title: "Visual content present",
        detail: `${Math.round(imageRatio * 100)}% of pages include images or diagrams.`,
      });
    } else {
      findings.push({
        type: "negative",
        title: "Few visual aids",
        detail: `Only ${Math.round(imageRatio * 100)}% of pages include images. Visual aids significantly improve comprehension.`,
      });
    }

    if (codeRatio >= 0.3) {
      findings.push({
        type: "positive",
        title: "Code examples included",
        detail: `${Math.round(codeRatio * 100)}% of pages include code examples.`,
      });
    } else if (codeRatio > 0) {
      findings.push({
        type: "suggestion",
        title: "Limited code examples",
        detail: `Only ${Math.round(codeRatio * 100)}% of pages include code examples. Consider adding more practical examples.`,
      });
    }

    if (avgWordCount < 150) {
      findings.push({
        type: "negative",
        title: "Thin content",
        detail: `Average page length is ${Math.round(avgWordCount)} words. Pages under 150 words may lack sufficient detail.`,
      });
    } else if (avgWordCount > 2000) {
      findings.push({
        type: "suggestion",
        title: "Lengthy pages",
        detail: `Average page length is ${Math.round(avgWordCount)} words. Consider breaking long pages into smaller, focused topics.`,
      });
    } else {
      findings.push({
        type: "positive",
        title: "Good content depth",
        detail: `Average page length is ${Math.round(avgWordCount)} words.`,
      });
    }

    // Short docs that may need expansion
    const thinDocs = docStats.filter((d) => d.wordCount < 100);
    if (thinDocs.length > 0) {
      findings.push({
        type: "negative",
        title: `${thinDocs.length} pages under 100 words`,
        detail: "Very short pages may be stubs or placeholders that need expansion.",
        affectedDocs: thinDocs.map((d) => d.title),
      });
    }

    const recommendations: string[] = [];
    if (imageRatio < 0.3)
      recommendations.push(
        "Add screenshots, diagrams, or illustrations to at least 30% of your documentation pages.",
      );
    if (headingRatio < 0.7)
      recommendations.push("Use H2 and H3 headings to break content into scannable sections.");
    if (listRatio < 0.3)
      recommendations.push(
        "Use bullet points and numbered lists for step-by-step instructions and feature lists.",
      );
    if (codeRatio < 0.2)
      recommendations.push("Include code examples and snippets to illustrate key concepts.");
    if (thinDocs.length > 0)
      recommendations.push(`Expand the ${thinDocs.length} pages that have fewer than 100 words.`);

    return {
      dimension: "Content Quality",
      score: totalScore,
      weight: DIMENSION_WEIGHTS.contentQuality,
      findings,
      recommendations,
    };
  }

  // ─── Information Architecture ────────────────────────────────────────────

  analyzeInformationArchitecture(documents: Document[]): DimensionResult {
    const findings: Finding[] = [];
    const docsWithUrls = documents.filter((d) => d.sourceUrl);

    if (docsWithUrls.length === 0) {
      return {
        dimension: "Information Architecture",
        score: 50,
        weight: DIMENSION_WEIGHTS.informationArchitecture,
        findings: [
          {
            type: "suggestion",
            title: "No URL structure available",
            detail:
              "Could not analyze URL structure. Documents were uploaded rather than crawled from a website.",
          },
        ],
        recommendations: [],
      };
    }

    // 1. URL depth analysis
    const depths = docsWithUrls.map((d) => {
      const url = new URL(d.sourceUrl!);
      return url.pathname.split("/").filter(Boolean).length;
    });
    const avgDepth = depths.reduce((a, b) => a + b, 0) / depths.length;
    const maxDepth = Math.max(...depths);

    // 2. Grouping analysis — how many distinct top-level sections
    const topLevelPaths = new Set(
      docsWithUrls.map((d) => {
        const url = new URL(d.sourceUrl!);
        const segments = url.pathname.split("/").filter(Boolean);
        return segments[0] || "root";
      }),
    );

    // 3. Cross-linking density — count how many docs reference other doc URLs
    const allUrls = new Set(docsWithUrls.map((d) => d.sourceUrl!));
    let crossLinkCount = 0;
    for (const doc of documents) {
      if (!doc.content) continue;
      for (const url of allUrls) {
        if (url !== doc.sourceUrl && doc.content.includes(url)) {
          crossLinkCount++;
        }
      }
    }
    const crossLinkRatio = documents.length > 1 ? crossLinkCount / documents.length : 0;

    // 4. Naming consistency — check if URLs use consistent separators
    const urlPaths = docsWithUrls.map((d) => new URL(d.sourceUrl!).pathname);
    const usesDashes = urlPaths.filter((p) => p.includes("-")).length;
    const usesUnderscores = urlPaths.filter((p) => p.includes("_")).length;
    const namingConsistent = usesDashes === 0 || usesUnderscores === 0;

    // Score components
    let score = 0;

    // Depth score (0-25): ideal avg depth 2-3
    if (avgDepth >= 1.5 && avgDepth <= 3.5) {
      score += 25;
      findings.push({
        type: "positive",
        title: "Good URL depth",
        detail: `Average URL depth is ${avgDepth.toFixed(1)} levels. URLs are neither too flat nor too deeply nested.`,
      });
    } else if (avgDepth > 3.5) {
      score += 10;
      findings.push({
        type: "negative",
        title: "Deep URL nesting",
        detail: `Average URL depth is ${avgDepth.toFixed(1)} levels. Deeply nested pages can be hard to find and navigate.`,
      });
    } else {
      score += 15;
      findings.push({
        type: "suggestion",
        title: "Flat URL structure",
        detail: `Average URL depth is ${avgDepth.toFixed(1)} levels. Some categorization could improve discoverability.`,
      });
    }

    // Grouping score (0-25): having multiple sections is good
    if (topLevelPaths.size >= 3 && topLevelPaths.size <= 8) {
      score += 25;
      findings.push({
        type: "positive",
        title: "Well-organized sections",
        detail: `Content is organized into ${topLevelPaths.size} top-level sections: ${Array.from(topLevelPaths).join(", ")}.`,
      });
    } else if (topLevelPaths.size < 3) {
      score += 10;
      findings.push({
        type: "suggestion",
        title: "Few content sections",
        detail: `Only ${topLevelPaths.size} top-level sections found. Consider grouping content into more categories.`,
      });
    } else {
      score += 15;
      findings.push({
        type: "suggestion",
        title: "Many top-level sections",
        detail: `${topLevelPaths.size} top-level sections may be overwhelming. Consider consolidating into 5-8 main categories.`,
      });
    }

    // Cross-linking score (0-25)
    if (crossLinkRatio >= 1.5) {
      score += 25;
      findings.push({
        type: "positive",
        title: "Good cross-linking",
        detail: `Pages reference each other frequently (${crossLinkRatio.toFixed(1)} cross-links per page on average).`,
      });
    } else if (crossLinkRatio >= 0.5) {
      score += 15;
      findings.push({
        type: "suggestion",
        title: "Moderate cross-linking",
        detail: `${crossLinkRatio.toFixed(1)} cross-links per page. Adding more internal links helps users discover related content.`,
      });
    } else {
      score += 5;
      findings.push({
        type: "negative",
        title: "Low cross-linking",
        detail: `Only ${crossLinkRatio.toFixed(1)} cross-links per page. Pages appear isolated — link related topics to each other.`,
      });
    }

    // Naming consistency score (0-25)
    if (namingConsistent) {
      score += 25;
      findings.push({
        type: "positive",
        title: "Consistent URL naming",
        detail: "URLs use a consistent naming convention.",
      });
    } else {
      score += 10;
      findings.push({
        type: "negative",
        title: "Inconsistent URL naming",
        detail: `URLs mix dashes (${usesDashes} pages) and underscores (${usesUnderscores} pages). Pick one convention.`,
      });
    }

    const recommendations: string[] = [];
    if (avgDepth > 3.5)
      recommendations.push("Flatten your URL structure to 2-3 levels deep for better navigation.");
    if (crossLinkRatio < 0.5)
      recommendations.push(
        "Add internal links between related documentation pages to improve discoverability.",
      );
    if (!namingConsistent)
      recommendations.push(
        "Standardize URL naming to use either dashes or underscores consistently.",
      );
    if (topLevelPaths.size < 3)
      recommendations.push(
        "Organize content into logical sections (e.g., Getting Started, Guides, API Reference, FAQ).",
      );
    if (maxDepth > 5)
      recommendations.push(
        `Some pages are ${maxDepth} levels deep. Consider restructuring to reduce maximum nesting.`,
      );

    return {
      dimension: "Information Architecture",
      score: Math.min(100, score),
      weight: DIMENSION_WEIGHTS.informationArchitecture,
      findings,
      recommendations,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private generateSummary(overallScore: number, dimensions: DimensionResult[]): string {
    const grade =
      overallScore >= 80
        ? "excellent"
        : overallScore >= 60
          ? "good"
          : overallScore >= 40
            ? "needs improvement"
            : "poor";

    const best = dimensions.reduce((a, b) => (a.score > b.score ? a : b));
    const worst = dimensions.reduce((a, b) => (a.score < b.score ? a : b));

    return `Your documentation scores ${overallScore}/100 (${grade}). Strongest area: ${best.dimension} (${best.score}/100). Most room for improvement: ${worst.dimension} (${worst.score}/100).`;
  }

  private fallbackDimensionResult(dimension: string, weight: number): DimensionResult {
    return {
      dimension,
      score: 50,
      weight,
      findings: [
        {
          type: "suggestion",
          title: "Analysis incomplete",
          detail:
            "Could not fully analyze this dimension. Score is estimated based on available data.",
        },
      ],
      recommendations: [],
    };
  }
}

export const docsAuditService = new DocsAuditService();
