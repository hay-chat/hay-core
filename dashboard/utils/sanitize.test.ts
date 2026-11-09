// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { safeHttpUrl, sanitizeHtml } from "@/utils/sanitize";
import { markdownToHtml } from "@/utils/markdownToHtml";

describe("sanitizeHtml", () => {
  it("removes scripts and event handlers", () => {
    const html = sanitizeHtml(
      '<p onclick="x()">hi</p><script>alert(1)</script><img src=x onerror=alert(1)>',
    );
    expect(html).not.toMatch(/script|onclick|onerror/i);
    expect(html).toContain("<p>hi</p>");
  });

  it("drops non-http(s) link and image URLs, whatever their case or padding", () => {
    for (const url of [
      "javascript:alert(1)",
      " JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      "vbscript:x",
      "//evil.example",
      "/\\evil.example",
    ]) {
      const html = sanitizeHtml(`<a href="${url}">x</a>`);
      expect(html).not.toContain("href");
    }
    expect(sanitizeHtml('<a href="https://ok.example">x</a>')).toContain(
      'href="https://ok.example"',
    );
    expect(sanitizeHtml('<a href="mailto:a@b.c">x</a>')).toContain('href="mailto:a@b.c"');
    expect(sanitizeHtml('<a href="/documents/1">x</a>')).toContain('href="/documents/1"');
  });

  it("forces links into a new tab without opener access", () => {
    const html = sanitizeHtml('<a href="https://ok.example" rel="opener" target="_self">x</a>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("strips id, class and style attributes", () => {
    const html = sanitizeHtml('<div id="app" class="fixed inset-0" style="color:red">x</div>');
    expect(html).toBe("<div>x</div>");
  });

  it("keeps only the classes a caller allows", () => {
    const html = sanitizeHtml(
      '<span class="mention-token fixed">a</span><p class="inset-0">b</p>',
      {
        allowedClasses: ["mention-token"],
      },
    );
    expect(html).toBe('<span class="mention-token">a</span><p>b</p>');
    // and does not leak into the next call
    expect(sanitizeHtml('<span class="mention-token">a</span>')).toBe("<span>a</span>");
  });

  it("drops images when images are not allowed", () => {
    expect(sanitizeHtml('<img src="https://img.example/a.png">', { allowImages: false })).toBe("");
    expect(sanitizeHtml('<img src="https://img.example/a.png">')).toContain("<img");
  });
});

describe("markdownToHtml", () => {
  it("keeps only the listed images when a list is given", () => {
    const md = "![a](https://cdn.test/a.png?v=1) ![b](https://evil.test/b.png)";
    const html = markdownToHtml(md, { allowedImageUrls: ["https://cdn.test/a.png?v=1"] });
    expect(html).toContain("cdn.test/a.png");
    expect(html).not.toContain("evil.test");
    expect(markdownToHtml(md, { allowedImageUrls: [] })).not.toContain("<img");
  });

  it("escapes link titles and URLs instead of inserting them raw", () => {
    const html = markdownToHtml('[x](https://ok.example "a\\" onmouseover=\\"alert(1)")');
    const link = new DOMParser().parseFromString(html, "text/html").querySelector("a")!;
    expect(link.getAttributeNames().sort()).toEqual(["href", "rel", "target", "title"]);
    expect(html).toContain('target="_blank"');
  });

  it("drops javascript: links", () => {
    expect(markdownToHtml("[x](javascript:alert(1))")).not.toContain("javascript");
  });

  it("drops images from customer-authored markdown", () => {
    const md = "look ![a](https://tracker.example/pixel.png)";
    expect(markdownToHtml(md, { allowImages: false })).not.toContain("<img");
    expect(markdownToHtml(md)).toContain("<img");
  });
});

describe("safeHttpUrl", () => {
  it("keeps absolute http(s) URLs only", () => {
    expect(safeHttpUrl("https://shop.example/p")).toBe("https://shop.example/p");
    expect(safeHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("/relative")).toBeUndefined();
    expect(safeHttpUrl(null)).toBeUndefined();
  });
});
