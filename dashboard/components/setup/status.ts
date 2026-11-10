import type { Component } from "vue";
import { AlertCircle, Check, Loader2, PenLine, Plug, Workflow } from "lucide-vue-next";
import type { SetupRowStatus } from "@/stores/setup";

/** Where a row sits on the board: something the customer has to do, being checked, or done. */
export type SetupGroup = "needs_you" | "checking" | "ready";

export const STATUS_GROUP: Record<SetupRowStatus, SetupGroup> = {
  checking: "checking",
  reading_site: "checking",
  ready: "ready",
  missing: "needs_you",
  needs_connection: "needs_you",
  playbook_off: "needs_you",
  playbook_missing: "needs_you",
  check_failed: "needs_you",
};

/** The progress bar's segment order: done first, then what needs the customer, then the rest. */
export const STATUS_ORDER: SetupRowStatus[] = [
  "ready",
  "playbook_off",
  "playbook_missing",
  "needs_connection",
  "missing",
  "check_failed",
  "checking",
  "reading_site",
];

type BadgeVariant = "secondary" | "success" | "warning" | "outline";

export const BADGE_VARIANTS: Record<SetupRowStatus, BadgeVariant> = {
  checking: "secondary",
  reading_site: "secondary",
  ready: "success",
  missing: "warning",
  needs_connection: "secondary",
  playbook_off: "secondary",
  playbook_missing: "secondary",
  check_failed: "outline",
};

// Setup keeps one saturated colour, the blue: steps that need the customer are a quiet blue tint
// and in-progress states a quiet grey. `!` beats the Badge variant's own colours.
export const BADGE_CLASSES: Partial<Record<SetupRowStatus, string>> = {
  checking: "!bg-background-tertiary !text-neutral-muted",
  reading_site: "!bg-background-tertiary !text-neutral-muted",
  needs_connection: "!bg-primary-50 !text-primary",
  playbook_off: "!bg-primary-50 !text-primary",
  playbook_missing: "!bg-primary-50 !text-primary",
};

/** The card's status tile: the badge's tint, with an icon for the kind of work left. */
export const STATUS_TILES: Record<SetupRowStatus, { icon: Component; classes: string }> = {
  checking: { icon: Loader2, classes: "bg-background-tertiary text-neutral-muted" },
  reading_site: { icon: Loader2, classes: "bg-background-tertiary text-neutral-muted" },
  ready: { icon: Check, classes: "bg-[rgb(220,252,231)] text-[rgb(22,101,52)]" },
  missing: { icon: PenLine, classes: "bg-[rgb(254,243,199)] text-[rgb(120,53,15)]" },
  needs_connection: { icon: Plug, classes: "bg-primary-50 text-primary" },
  playbook_off: { icon: Workflow, classes: "bg-primary-50 text-primary" },
  playbook_missing: { icon: Workflow, classes: "bg-primary-50 text-primary" },
  check_failed: { icon: AlertCircle, classes: "bg-background-tertiary text-neutral-700" },
};

/** The progress bar's colour for each status, a stronger shade of the badge's. */
export const STATUS_BAR_CLASSES: Record<SetupRowStatus, string> = {
  ready: "bg-[rgb(34,197,94)]",
  missing: "bg-[rgb(217,119,6)]",
  needs_connection: "bg-primary",
  playbook_off: "bg-primary",
  playbook_missing: "bg-primary",
  check_failed: "bg-neutral-500",
  checking: "bg-neutral-300",
  reading_site: "bg-neutral-300",
};
