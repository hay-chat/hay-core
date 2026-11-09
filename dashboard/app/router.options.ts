import type { RouterConfig } from "nuxt/schema";
import { createOrgHistory } from "@/utils/org-history";

export default {
  history: (base) => (import.meta.client ? createOrgHistory(base) : null),
} satisfies RouterConfig;
