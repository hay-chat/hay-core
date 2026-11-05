import type { SetupRow, SetupUpNext } from "@/stores/setup";

type Translate = (key: string, params?: Record<string, unknown>) => string;

/** "orders" -> "look up orders": what a connected platform lets the assistant do. */
export function needsLabel(t: Translate, needs: SetupRow["needs"]): string {
  return needs ? t(`setup.needs.${needs}`) : t("setup.needs.generic");
}

export function requestsCount(
  t: Translate,
  key: string,
  count: number,
  extra: Record<string, unknown> = {},
): string {
  return t(`${key}${count === 1 ? "One" : "Other"}`, { count, ...extra });
}

/** "So your assistant can look up orders. This unlocks 3 requests", or the generic line. */
function unlocksCopy(
  t: Translate,
  key: string,
  unlocks: number,
  capability: SetupRow["needs"],
): string {
  return capability
    ? requestsCount(t, `${key}.whyCapability`, unlocks, { capability: needsLabel(t, capability) })
    : requestsCount(t, `${key}.why`, unlocks);
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
        why: unlocksCopy(t, "setup.upNext.connect", upNext.unlocks, upNext.capability),
        label: t("setup.upNext.connect.label", { plugin: upNext.plugin.name }),
      };
    case "choose_platform":
      return {
        title: t("setup.upNext.choosePlatform.title"),
        why: unlocksCopy(t, "setup.upNext.choosePlatform", upNext.unlocks, upNext.capability),
        label: t("setup.upNext.choosePlatform.label"),
      };
    case "playbook":
      return {
        title: t("setup.upNext.playbook.title", { playbook: upNext.title }),
        why: t("setup.upNext.playbook.why"),
        label: t("setup.upNext.playbook.label"),
      };
    case "write_playbook":
      return {
        title: t("setup.upNext.writePlaybook.title", { question: upNext.text }),
        why: t("setup.upNext.writePlaybook.why"),
        label: t("setup.upNext.writePlaybook.label"),
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
