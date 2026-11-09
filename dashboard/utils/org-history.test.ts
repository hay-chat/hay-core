// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRequestedOrganization,
  createOrgHistory,
  getRequestedOrganization,
  setUrlOrganization,
} from "./org-history";

const ORG = "6f1c2a34-90ab-4cde-8f01-23456789abcd";

const open = (url: string) => {
  window.history.replaceState(null, "", url);
  return createOrgHistory("/");
};

describe("createOrgHistory", () => {
  beforeEach(() => {
    clearRequestedOrganization();
    setUrlOrganization(null);
  });

  it("gives the router the plain path and remembers the organization", () => {
    const history = open(`/${ORG}/inbox?a=1`);
    expect(history.location).toBe("/inbox?a=1");
    expect(getRequestedOrganization()).toBe(ORG);
    history.destroy();
  });

  it("reads an old ?org= link the same way", () => {
    const history = open(`/inbox?question=q&org=${ORG}`);
    expect(history.location).toBe("/inbox?question=q");
    expect(getRequestedOrganization()).toBe(ORG);
    history.destroy();
  });

  it("requests nothing for a plain URL", () => {
    const history = open("/inbox");
    expect(history.location).toBe("/inbox");
    expect(getRequestedOrganization()).toBeNull();
    history.destroy();
  });

  it("writes the active organization into the address bar and hrefs", () => {
    const history = open("/inbox");
    setUrlOrganization(ORG);

    history.replace("/inbox");
    expect(window.location.pathname).toBe(`/${ORG}/inbox`);
    history.push("/playbooks?x=1");
    expect(window.location.pathname + window.location.search).toBe(`/${ORG}/playbooks?x=1`);
    expect(history.location).toBe("/playbooks?x=1");
    expect(history.createHref("/settings/llm")).toBe(`/${ORG}/settings/llm`);
    expect(history.createHref("/login")).toBe("/login");
    history.destroy();
  });

  it("hands back/forward to the router without the prefix", async () => {
    const history = open("/inbox");
    setUrlOrganization(ORG);
    history.replace("/inbox");
    history.push("/playbooks");

    const listener = vi.fn();
    history.listen(listener);
    const moved = new Promise((resolve) => window.addEventListener("popstate", resolve));
    window.history.back();
    await moved;

    expect(listener.mock.calls[0]?.slice(0, 2)).toEqual(["/inbox", "/playbooks"]);
    history.destroy();
  });
});
