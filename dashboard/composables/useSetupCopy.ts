import type { SetupRow, SetupUpNext } from "@/stores/setup";

type Translate = (key: string, params?: Record<string, unknown>) => string;

/** "orders" -> "look up orders": what a connected platform lets the assistant do. */
export function needsLabel(t: Translate, needs: SetupRow["needs"]): string {
  return needs ? t(`setup.needs.${needs}`) : t("setup.needs.generic");
}

export function requestsCount(t: Translate, key: string, count: number): string {
  return t(`${key}${count === 1 ? "One" : "Other"}`, { count });
}

export interface UpNextCopy {
  title: string;
  why: string;
  /** Empty for `done`, where the action is a plain link. */
  label: string;
}

/** Words for the single most useful next step, shared by the board strip and the sidebar. */
export function describeUpNext(t: Translate, upNext: SetupUpNext): UpNextCopy {
  switch (upNext.kind) {
    case "connect":
      return {
        title: t("setup.upNext.connect.title", { plugin: upNext.plugin.name }),
        why: requestsCount(t, "setup.upNext.connect.why", upNext.unlocks),
        label: t("setup.upNext.connect.label", { plugin: upNext.plugin.name }),
      };
    case "choose_platform":
      return {
        title: t("setup.upNext.choosePlatform.title"),
        why: requestsCount(t, "setup.upNext.choosePlatform.why", upNext.unlocks),
        label: t("setup.upNext.choosePlatform.label"),
      };
    case "playbook":
      return {
        title: t("setup.upNext.playbook.title", { playbook: upNext.title }),
        why: t("setup.upNext.playbook.why"),
        label: t("setup.upNext.playbook.label"),
      };
    case "answer":
      return {
        title: t("setup.upNext.answer.title", { question: upNext.text }),
        why: t("setup.upNext.answer.why"),
        label: t("setup.upNext.answer.label"),
      };
    case "done":
      return {
        title: t("setup.upNext.done.title"),
        why: t("setup.upNext.done.why"),
        label: t("setup.upNext.done.label"),
      };
  }
}
