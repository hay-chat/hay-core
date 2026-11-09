import { ref } from "vue";
import type { RouterOutputs } from "@/types/trpc";
import { Hay } from "@/utils/api";

const status = ref<RouterOutputs["auth"]["mfa"]["status"] | null>(null);

/** The signed-in person's second-factor state, shared by the settings cards and the step-up dialog. */
export function useMfaStatus() {
  const loadStatus = async () => {
    status.value = await Hay.auth.mfa.status.query();
  };
  return { status, loadStatus };
}
