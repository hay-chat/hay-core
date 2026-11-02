import { defineStore } from "pinia";
import type { Organization } from "./user";

export const useOrganizationStore = defineStore("organization", {
  state: () => ({
    current: null as Organization | null,
  }),
  actions: {
    setCurrent(organization: Organization) {
      this.current = organization;
    },
  },
  persist: {
    pick: ["current"],
  },
});
