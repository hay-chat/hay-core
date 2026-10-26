import { describe, expect, it } from "vitest";
import {
  headerValue,
  headersFromObject,
  htmlToText,
  normalizeMessageId,
  parseAddress,
  parseAddressList,
  parseHeaderBlock,
  parseMessageIds,
  textToHtml,
} from "./mime.js";

describe("parseAddress", () => {
  it("handles display names, bare addresses and angle brackets", () => {
    expect(parseAddress('"Ana Shopper" <Ana@Shopper.com>')).toEqual({
      name: "Ana Shopper",
      address: "ana@shopper.com",
    });
    expect(parseAddress("Ana Shopper <ana@shopper.com>")).toEqual({
      name: "Ana Shopper",
      address: "ana@shopper.com",
    });
    expect(parseAddress("ana@shopper.com")).toEqual({ address: "ana@shopper.com" });
    expect(parseAddress("not an address")).toBeNull();
  });
});

describe("parseAddressList", () => {
  it("splits on commas outside quotes and brackets and accepts arrays", () => {
    const list = parseAddressList('"Doe, Jane" <jane@x.com>, bob@y.com');
    expect(list.map((address) => address.address)).toEqual(["jane@x.com", "bob@y.com"]);
    expect(parseAddressList(["a@b.c", "garbage"]).map((a) => a.address)).toEqual(["a@b.c"]);
    expect(parseAddressList(undefined)).toEqual([]);
  });
});

describe("headers", () => {
  it("lowercases names from an object and unfolds a raw header block", () => {
    const fromObject = headersFromObject({
      "In-Reply-To": "<a@b>",
      References: ["<a@b>", "<c@d>"],
    });
    expect(headerValue(fromObject, "in-reply-to")).toBe("<a@b>");
    expect(fromObject.references).toEqual(["<a@b>", "<c@d>"]);

    const raw =
      "Subject: Hello\r\nReferences: <a@b>\r\n <c@d>\r\nAuto-Submitted: auto-replied\r\n\r\nbody: not a header";
    const parsed = parseHeaderBlock(raw);
    expect(parsed.references).toEqual(["<a@b> <c@d>"]);
    expect(headerValue(parsed, "Auto-Submitted")).toBe("auto-replied");
    expect(parsed.body).toBeUndefined();
  });

  it("extracts and normalises message ids", () => {
    expect(parseMessageIds("<a@b> <c@d>")).toEqual(["<a@b>", "<c@d>"]);
    expect(normalizeMessageId("abc@shopper.com")).toBe("<abc@shopper.com>");
    expect(normalizeMessageId("<abc@shopper.com>")).toBe("<abc@shopper.com>");
    expect(normalizeMessageId("")).toBeUndefined();
  });
});

describe("html", () => {
  it("renders html to readable text", () => {
    const text = htmlToText(
      "<html><head><style>p{}</style></head><body><p>Hi&nbsp;there,</p><div>Order <b>1234</b><br>is late &amp; cold</div><ul><li>one</li></ul></body></html>",
    );
    expect(text).toBe("Hi there,\nOrder 1234\nis late & cold\n- one");
  });

  it("escapes text when building html", () => {
    expect(textToHtml("a < b\n\nsecond")).toContain("<p>a &lt; b</p><p>second</p>");
  });
});
