import { useUserStore } from "@/stores/user";
import { setUrlOrganization } from "@/utils/org-history";

/** Keep the organization in the address bar in step with the active one. */
export default defineNuxtPlugin(() => {
  const userStore = useUserStore();
  watch(() => userStore.activeOrganizationId, setUrlOrganization, {
    immediate: true,
    flush: "sync",
  });
});
