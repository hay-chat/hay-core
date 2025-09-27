import { defineStore } from "pinia";
import type { Organization } from "./user";

export const useOrganizationStore = defineStore("organization", {
  state: () => ({
    current: null as Organization | null,
    available: [] as Organization[],
  }),
  actions: {
    setCurrent(organization: Organization) {
      this.current = organization;
    },
  },
  persist: true,
});
