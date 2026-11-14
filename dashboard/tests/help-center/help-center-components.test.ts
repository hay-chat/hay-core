// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { mountWithStubs, stubNuxtGlobals } from "../component-harness";
import { article, BASE_DOMAIN, buttonLabelled, collection, helpCenter, stubs } from "./fixtures";

const api = await vi.hoisted(async () => (await import("./fixtures")).createApi());
vi.mock("@/utils/api", async () => (await import("./fixtures")).hayMock(api));

import HelpCenterBasicsFields from "../../components/help-center/HelpCenterBasicsFields.vue";
import HelpCenterContentTab from "../../components/help-center/HelpCenterContentTab.vue";
import HelpCenterDomainTab from "../../components/help-center/HelpCenterDomainTab.vue";
import HelpCenterAppearanceTab from "../../components/help-center/HelpCenterAppearanceTab.vue";
import HelpCenterThemeFields from "../../components/help-center/HelpCenterThemeFields.vue";

beforeEach(() => {
  vi.clearAllMocks();
  stubNuxtGlobals();
});

describe("help center address field", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function statusFor(subdomain: string, props: Record<string, unknown> = {}) {
    const wrapper = mountWithStubs(HelpCenterBasicsFields, {
      props: {
        modelValue: { name: "Acme", subdomain, language: "en" },
        baseDomain: BASE_DOMAIN,
        ...props,
      },
    });
    await vi.advanceTimersByTimeAsync(500);
    await nextTick();
    return wrapper;
  }
  const status = (wrapper: Awaited<ReturnType<typeof statusFor>>) =>
    wrapper.find('[data-testid="subdomain-status"]').text();

  it.each([
    ["too_short", "helpCenter.basics.addressTooShort"],
    ["too_long", "helpCenter.basics.addressTooLong"],
    ["invalid_characters", "helpCenter.basics.addressInvalid"],
    ["reserved", "helpCenter.basics.addressReserved"],
    ["taken", "helpCenter.basics.addressTaken"],
  ])("explains %s and blocks the address", async (reason, message) => {
    api.checkSubdomain.mockResolvedValue({ available: false, reason });
    const wrapper = await statusFor("acme");

    expect(api.checkSubdomain).toHaveBeenCalledWith({ subdomain: "acme" });
    expect(status(wrapper)).toBe(message);
    expect(wrapper.emitted("update:addressOk")!.at(-1)).toEqual([false]);
  });

  it("confirms a free address, naming it in full", async () => {
    api.checkSubdomain.mockResolvedValue({ available: true });
    const wrapper = await statusFor("acme");

    expect(status(wrapper)).toContain("helpCenter.basics.addressAvailable");
    expect(status(wrapper)).toContain(`acme.${BASE_DOMAIN}`);
    expect(wrapper.emitted("update:addressOk")!.at(-1)).toEqual([true]);
  });

  it("checks only after typing pauses, and only the last address", async () => {
    api.checkSubdomain.mockResolvedValue({ available: true });
    const wrapper = await statusFor("acme");
    api.checkSubdomain.mockClear();

    for (const subdomain of ["acme-h", "acme-he", "acme-help"]) {
      await wrapper.setProps({ modelValue: { name: "Acme", subdomain, language: "en" } });
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(api.checkSubdomain).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);

    expect(api.checkSubdomain).toHaveBeenCalledTimes(1);
    expect(api.checkSubdomain).toHaveBeenCalledWith({ subdomain: "acme-help" });
  });

  it("does not check the address the help center already has", async () => {
    const wrapper = await statusFor("acme", { currentSubdomain: "acme" });

    expect(api.checkSubdomain).not.toHaveBeenCalled();
    expect(status(wrapper)).toContain("helpCenter.basics.addressCurrent");
    expect(wrapper.emitted("update:addressOk")!.at(-1)).toEqual([true]);
  });
});

describe("help center content tab", () => {
  const collections = () => [collection("a", [article("d1")]), collection("b", [article("d9")])];

  it("reorders collections with the full new order", async () => {
    api.reorderCollections.mockResolvedValue({ success: true });
    const wrapper = mountWithStubs(HelpCenterContentTab, {
      props: { collections: collections() },
      stubs,
    });

    const up = 'helpCenter.content.moveCollectionUp {"title":"Collection a"}';
    expect(buttonLabelled(wrapper, up)!.attributes("disabled")).toBeDefined();
    await buttonLabelled(
      wrapper,
      'helpCenter.content.moveCollectionDown {"title":"Collection a"}',
    )!.trigger("click");
    await flushPromises();

    expect(api.reorderCollections).toHaveBeenCalledWith({ ids: ["b", "a"] });
    expect(wrapper.findAll('[data-testid^="collection-"]')[0].text()).toContain("Collection b");
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });

  it("puts the order back and says why when a reorder fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.reorderCollections.mockRejectedValue(new Error("nope"));
    const wrapper = mountWithStubs(HelpCenterContentTab, {
      props: { collections: collections() },
      stubs,
    });

    await buttonLabelled(
      wrapper,
      'helpCenter.content.moveCollectionDown {"title":"Collection a"}',
    )!.trigger("click");
    await flushPromises();

    expect(wrapper.findAll('[data-testid^="collection-"]')[0].text()).toContain("Collection a");
  });

  it("adds picked documents after the existing articles, warning that they become public", async () => {
    api.setCollectionArticles.mockResolvedValue({ success: true });
    api.listDocuments.mockResolvedValue({
      items: [
        { id: "d1", title: "Doc d1", status: "published" },
        { id: "d2", title: "Doc d2", status: "published" },
        { id: "d3", title: "Doc d3", status: "draft" },
        { id: "d9", title: "Doc d9", status: "published" },
      ],
      pagination: { totalPages: 1 },
    });
    const wrapper = mountWithStubs(HelpCenterContentTab, {
      props: { collections: collections() },
      stubs,
    });

    await wrapper
      .find('[data-testid="collection-a"]')
      .findAll("button")
      .find((button) => button.text().includes("helpCenter.content.addArticles"))!
      .trigger("click");
    await flushPromises();

    const rows = wrapper.findAll("li label");
    expect(rows).toHaveLength(4);
    // Already here: ticked and locked. In another collection: says it will move.
    expect(rows[0].find("input").attributes("disabled")).toBeDefined();
    expect(rows[0].text()).toContain("helpCenter.picker.alreadyHere");
    expect(rows[3].text()).toContain(
      'helpCenter.picker.inCollection {"collection":"Collection b"}',
    );
    expect(wrapper.find('[data-testid="public-notice"]').exists()).toBe(false);

    await rows[2].find("input").setValue(true);
    await rows[1].find("input").setValue(true);
    expect(wrapper.find('[data-testid="public-notice"]').text()).toContain(
      "helpCenter.articles.publicNotice",
    );

    await wrapper.find('[data-testid="confirm-add-articles"]').trigger("click");
    await flushPromises();

    expect(api.setCollectionArticles).toHaveBeenCalledWith({
      collectionId: "a",
      documentIds: ["d1", "d3", "d2"],
    });
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });

  it("marks articles that are not live, and why", () => {
    const wrapper = mountWithStubs(HelpCenterContentTab, {
      props: {
        collections: [
          collection("a", [
            article("d1"),
            article("d2", false),
            { ...article("d3", false), status: "published", visibility: "private" },
          ]),
        ],
      },
      stubs,
    });

    const badges = wrapper.findAll('[data-stub="Badge"]').map((badge) => badge.text());
    expect(badges).toEqual([
      "helpCenter.content.notLive.draft",
      "helpCenter.content.notLive.notPublic",
    ]);
    expect(wrapper.find('a[href="/documents/d2"]').exists()).toBe(true);
  });
});

describe("help center domain tab", () => {
  const pending = () =>
    helpCenter({
      customDomain: {
        domain: "help.acme.com",
        verified: false,
        verifiedAt: null,
        checkedAt: null,
        records: {
          cname: { name: "help.acme.com", value: `hc-abc123.${BASE_DOMAIN}` },
          txt: { name: "_hay-help-center.help.acme.com", value: "hay-help-center=hc-abc123" },
        },
      },
    });

  it("shows both DNS records for a pending domain", () => {
    const wrapper = mountWithStubs(HelpCenterDomainTab, { props: { helpCenter: pending() } });

    expect(wrapper.find('[data-testid="domain-status"]').text()).toBe("helpCenter.domain.pending");
    const cname = wrapper.find('[data-testid="record-CNAME"]').text();
    expect(cname).toContain("helpCenter.domain.recommended");
    expect(cname).toContain("help.acme.com");
    expect(cname).toContain(`hc-abc123.${BASE_DOMAIN}`);
    const txt = wrapper.find('[data-testid="record-TXT"]').text();
    expect(txt).toContain("helpCenter.domain.alternative");
    expect(txt).toContain("_hay-help-center.help.acme.com");
    expect(txt).toContain("hay-help-center=hc-abc123");
  });

  it("shows the server's reason when the record is not found yet", async () => {
    api.verifyCustomDomain.mockRejectedValue(new Error("We did not find the DNS record yet."));
    const wrapper = mountWithStubs(HelpCenterDomainTab, { props: { helpCenter: pending() } });

    await wrapper.find('[data-testid="verify-domain"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="verify-error"]').text()).toBe(
      "We did not find the DNS record yet.",
    );
    // The failed check recorded a time on the server: the page re-reads it.
    expect(wrapper.emitted("refresh")).toHaveLength(1);
    expect(wrapper.emitted("updated")).toBeUndefined();
  });

  it("hands a verified domain back to the page", async () => {
    const verified = pending();
    verified.customDomain!.verified = true;
    api.verifyCustomDomain.mockResolvedValue(verified);
    const wrapper = mountWithStubs(HelpCenterDomainTab, { props: { helpCenter: pending() } });

    await wrapper.find('[data-testid="verify-domain"]').trigger("click");
    await flushPromises();

    expect(wrapper.emitted("updated")).toEqual([[verified]]);
    expect(wrapper.find('[data-testid="verify-error"]').exists()).toBe(false);
  });
});

describe("help center appearance", () => {
  const theme = helpCenter().theme;

  it("frames the real site with the draft theme, titled for screen readers", () => {
    const wrapper = mountWithStubs(HelpCenterAppearanceTab, {
      props: {
        modelValue: { ...theme, accentColor: "#ff8800" },
        dirty: true,
        previewLink: { baseUrl: `https://acme.${BASE_DOMAIN}`, token: "123.sig" },
      },
    });

    const frame = wrapper.find('[data-testid="preview-frame"]');
    expect(frame.attributes("title")).toBe("helpCenter.appearance.previewFrameTitle");
    const src = new URL(frame.attributes("src")!);
    expect(src.origin).toBe(`https://acme.${BASE_DOMAIN}`);
    expect(src.searchParams.get("hc_preview")).toBe("123.sig");
    const sent = JSON.parse(
      Buffer.from(src.searchParams.get("hc_theme")!, "base64url").toString("utf8"),
    );
    expect(sent).toEqual({ ...theme, accentColor: "#ff8800" });
  });

  it("shows a placeholder when there is no preview link", () => {
    const wrapper = mountWithStubs(HelpCenterAppearanceTab, {
      props: { modelValue: theme, dirty: false, previewLink: null },
    });

    expect(wrapper.find('[data-testid="preview-frame"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="preview-placeholder"]').exists()).toBe(true);
  });

  it("warns about a light accent colour and ignores a half-typed one", async () => {
    const wrapper = mountWithStubs(HelpCenterThemeFields, {
      props: { modelValue: { ...theme, accentColor: "#ffcc00" } },
    });
    expect(wrapper.find('[data-testid="accent-contrast-warning"]').exists()).toBe(true);

    await wrapper.find("#hc-accent-hex").setValue("#12");
    expect(wrapper.find('[data-testid="accent-invalid"]').exists()).toBe(true);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    await wrapper.find("#hc-accent-hex").setValue("#123ABC");
    expect(wrapper.emitted("update:modelValue")!.at(-1)).toEqual([
      { ...theme, accentColor: "#123abc" },
    ]);
  });
});
