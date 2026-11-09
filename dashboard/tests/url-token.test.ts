// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { route, router, stubNuxtGlobals } from "./component-harness";
import { useUrlToken } from "../composables/useUrlToken";

describe("useUrlToken", () => {
  beforeEach(() => {
    stubNuxtGlobals();
    router.replace.mockClear();
  });

  function mountWithToken() {
    let token = "";
    mount(
      defineComponent({
        setup() {
          token = useUrlToken().value;
          return () => h("div");
        },
      }),
    );
    return token;
  }

  it("returns the token and drops it from the URL, keeping other params", () => {
    route.path = "/verify-email";
    route.query = { token: "secret", type: "change" };

    expect(mountWithToken()).toBe("secret");
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace.mock.calls[0][0]).toMatchObject({
      path: "/verify-email",
      query: { type: "change" },
    });
    expect(JSON.stringify(router.replace.mock.calls[0][0])).not.toContain("secret");
  });

  it("leaves the URL alone when there is no token", () => {
    route.query = {};
    expect(mountWithToken()).toBe("");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("ignores a repeated token param", () => {
    route.query = { token: ["a", "b"] };
    expect(mountWithToken()).toBe("");
  });
});
