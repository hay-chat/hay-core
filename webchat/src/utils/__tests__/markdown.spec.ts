import { describe, it, expect } from "vitest";
import { parseMarkdown, safeHttpUrl } from "../markdown";

describe("safeHttpUrl", () => {
  it("keeps absolute http(s) URLs", () => {
    expect(safeHttpUrl("https://shop.example/p/1")).toBe("https://shop.example/p/1");
    expect(safeHttpUrl(" http://shop.example ")).toBe("http://shop.example/");
  });

  it("drops other schemes, relative URLs and non-strings", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpUrl(" JaVaScRiPt:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("data:text/html,<b>x</b>")).toBeUndefined();
    expect(safeHttpUrl("/relative")).toBeUndefined();
    expect(safeHttpUrl(undefined)).toBeUndefined();
    expect(safeHttpUrl(42)).toBeUndefined();
  });
});

describe("parseMarkdown output safety", () => {
  const ALLOWED_TAGS = new Set(["A", "IMG", "P", "BR", "UL", "OL", "LI", "STRONG", "EM", "CODE"]);
  const ALLOWED_ATTRIBUTES = new Set(["href", "src", "alt", "loading", "target", "rel"]);

  function render(markdown: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = parseMarkdown(markdown);
    return root;
  }

  it.each([
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "[x](javascript:alert(1))",
    "[x](JaVaScRiPt:alert(1))",
    "[x](data:text/html,<script>alert(1)</script>)",
    "![x](javascript:alert(1))",
    '[x](https://a.example" onmouseover="alert(1))',
    '![x](https://a.example" onerror="alert(1))',
    '![x" onerror="alert(1)](https://a.example/i.png)',
    "![a](http://x.example/[b](http://y onerror=alert&#40;1&#41; x) z)",
    "![x[y](http://u.example/i.png) tail](http://z.example onerror=a)",
    "[a](http://x.example/**b** onerror=c **d**)",
    "`<img src=x onerror=alert(1)>`",
    "**<svg onload=alert(1)>**",
    "\uE0000\uE001 [a](https://a.example)",
  ])("adds no tags or attributes beyond its own for %j", (payload) => {
    const elements = [...render(payload).querySelectorAll("*")];
    for (const element of elements) {
      expect(ALLOWED_TAGS.has(element.tagName)).toBe(true);
      for (const attribute of element.getAttributeNames()) {
        expect(ALLOWED_ATTRIBUTES.has(attribute)).toBe(true);
      }
      for (const url of [element.getAttribute("href"), element.getAttribute("src")]) {
        if (url !== null) expect(url).toMatch(/^https?:\/\//i);
      }
    }
  });

  it("does not let markdown run inside a URL", () => {
    const link = render("[a](https://a.example/**b**/`c`/*d*)").querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://a.example/**b**/`c`/*d*");
  });

  it("keeps the query string of a URL intact", () => {
    const link = render("[a](https://a.example/?x=1&y=2)").querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://a.example/?x=1&y=2");
  });

  it("still renders formatted labels and images inside links", () => {
    const root = render(
      "[**bold**](https://a.example) [![i](https://a.example/i.png)](https://b.example)",
    );
    expect(root.querySelector("a strong")?.textContent).toBe("bold");
    expect(root.querySelector("a img")?.getAttribute("src")).toBe("https://a.example/i.png");
  });
});
