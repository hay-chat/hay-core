import { afterEach, describe, expect, it, jest } from "@jest/globals";
import crypto from "crypto";

const safeFetch = jest.fn<(url: string, init: unknown) => Promise<Response>>();
jest.mock("@server/utils/ssrf", () => ({ safeFetch }));

import { isBreachedPassword, newPasswordSchema } from "@server/lib/auth/password-policy";

const sha1 = (value: string) => crypto.createHash("sha1").update(value).digest("hex").toUpperCase();

describe("newPasswordSchema", () => {
  it("accepts a password meeting every rule", () => {
    expect(newPasswordSchema.safeParse("Str0ng!pass").success).toBe(true);
  });

  it.each(["Sh0rt!", "alllower1!", "ALLUPPER1!", "NoDigits!!", "NoSpecial12"])(
    "rejects %s",
    (pw) => {
      expect(newPasswordSchema.safeParse(pw).success).toBe(false);
    },
  );
});

describe("isBreachedPassword", () => {
  afterEach(() => safeFetch.mockReset());

  it("sends only the hash prefix and finds a listed suffix", async () => {
    const hash = sha1("hunter2");
    safeFetch.mockResolvedValue(new Response(`ABC:1\r\n${hash.slice(5)}:12\r\n`));

    await expect(isBreachedPassword("hunter2")).resolves.toBe(true);

    expect(safeFetch.mock.calls[0][0]).toBe(
      `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`,
    );
  });

  it("ignores padding rows", async () => {
    safeFetch.mockResolvedValue(new Response(`${sha1("hunter2").slice(5)}:0\r\n`));
    await expect(isBreachedPassword("hunter2")).resolves.toBe(false);
  });

  it("allows the password when the lookup fails", async () => {
    safeFetch.mockRejectedValue(new Error("network down"));
    await expect(isBreachedPassword("hunter2")).resolves.toBe(false);
    safeFetch.mockResolvedValue(new Response("", { status: 503 }));
    await expect(isBreachedPassword("hunter2")).resolves.toBe(false);
  });
});
