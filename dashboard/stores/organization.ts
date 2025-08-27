import { defineStore } from "pinia";

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

export const useOrganizationStore = defineStore("organization", {
  persist: true,
  state: () => ({
    current: null as Organization | null,
    available: [] as Organization[],
  }),
  actions: {
    setCurrent(organization: Organization) {
      this.current = organization;
    },
  },
});
