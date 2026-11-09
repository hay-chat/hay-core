import { describe, expect, it } from "vitest";
import { parseConnectReturnUrl } from "./connect-request";

describe("parseConnectReturnUrl", () => {
  it.each([
    ["https://shop.example/wp-admin/admin.php?page=hay", undefined],
    ["https://shop.example/wp-admin/", "https://shop.example"],
    ["https://shop.example/wp-admin/", "https://www.shop.example/"],
    ["http://localhost:8080/wp-admin/", undefined],
    ["http://127.0.0.1/wp-admin/", undefined],
  ])("accepts %s", (url, site) => {
    expect(parseConnectReturnUrl(url, site)?.href).toBe(new URL(url).href);
  });

  it.each([
    ["not a url", undefined],
    ["javascript:alert(1)", undefined],
    ["data:text/html,x", undefined],
    ["http://shop.example/wp-admin/", undefined],
    ["http://localhost.evil.example/", undefined],
    ["https://user:pass@shop.example/", undefined],
    ["https://evil.example/", "https://shop.example"],
    ["https://shop.example.evil.example/", "https://shop.example"],
    ["https://shop.example/", "not a url"],
  ])("refuses %s (site %s)", (url, site) => {
    expect(parseConnectReturnUrl(url, site)).toBeNull();
  });
});
