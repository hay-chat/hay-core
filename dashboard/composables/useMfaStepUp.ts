import { ref } from "vue";

const open = ref(false);

/** Ask the signed-in person for a two-factor code (dialog in the default layout). */
export function requestMfaStepUp(): void {
  open.value = true;
}

export function useMfaStepUp() {
  return { open };
}
