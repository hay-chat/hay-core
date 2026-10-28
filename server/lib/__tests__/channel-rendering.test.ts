import { describe, it, expect } from "@jest/globals";
import {
  markdownToWhatsApp,
  renderForChannel,
  renderProductList,
  stripMarkdown,
} from "@server/lib/channel-rendering";

describe("stripMarkdown", () => {
  it("removes emphasis, headings, quotes and code but keeps the words", () => {
    const md =
      "# Order help\n> **Note:** __really__ ~~old~~ *soon* _now_ `code`\n---\n- one\n* two";
    expect(stripMarkdown(md)).toBe("Order help\nNote: really old soon now code\n• one\n• two");
  });

  it("turns links into text with the url and images into the url", () => {
    expect(
      stripMarkdown("See [the guide](https://x.example/a_b) or ![pic](https://x.example/p.png)"),
    ).toBe("See the guide (https://x.example/a_b) or https://x.example/p.png");
    expect(stripMarkdown("[https://x.example](https://x.example)")).toBe("https://x.example");
  });

  it("leaves snake_case, URLs and lone asterisks alone", () => {
    const text = "Use code SAVE_10_NOW at https://x.example/a_b_c, 2 * 3 = 6";
    expect(stripMarkdown(text)).toBe(text);
  });

  it("keeps fenced code content", () => {
    expect(stripMarkdown("```js\nconst a = 1;\n```")).toBe("const a = 1;");
  });
});

describe("markdownToWhatsApp", () => {
  it("maps bold, italic and strike to WhatsApp's markers", () => {
    expect(markdownToWhatsApp("**bold** *italic* ~~gone~~ __also bold__")).toBe(
      "*bold* _italic_ ~gone~ *also bold*",
    );
  });

  it("makes headings bold and inlines links", () => {
    expect(markdownToWhatsApp("## Returns\nRead [policy](https://x.example)")).toBe(
      "*Returns*\nRead policy (https://x.example)",
    );
  });
});

describe("renderForChannel", () => {
  it("passes text through without a declaration", () => {
    expect(renderForChannel("**x**", undefined)).toBe("**x**");
    expect(renderForChannel("**x**", { markdown: "markdown" })).toBe("**x**");
  });
});

describe("renderProductList", () => {
  it("lists title, localized price and link, skipping untitled products and non-http links", () => {
    const list = renderProductList(
      [
        {
          title: "Shoe",
          sourceUrl: "https://s.example/shoe",
          topVariant: { price: "10.5", currency: "USD" },
        },
        { title: "" },
        {
          title: "Hat",
          sourceUrl: "javascript:alert(1)",
          topVariant: { price: "abc", currency: "USD" },
        },
      ],
      "en",
    );
    expect(list).toBe("• Shoe · $10.50\nhttps://s.example/shoe\n\n• Hat");
  });
});
