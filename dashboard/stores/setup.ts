import { defineStore } from "pinia";
import { TRPCClientError } from "@trpc/client";
import { Hay } from "@/utils/api";
import { useUserStore } from "@/stores/user";
import type { RouterInputs, RouterOutputs } from "@/types/trpc";

export type SetupBoard = RouterOutputs["setup"]["get"];
export type SetupRow = SetupBoard["rows"][number];
export type SetupRowStatus = SetupRow["status"];
export type SetupUpNext = SetupBoard["upNext"];
export type SetupSiteState = SetupBoard["site"];
export type SetupSuggestions = RouterOutputs["setup"]["suggestions"];
/** What a row's edit panel sends: only the fields the person changed. */
export type SetupRowChanges = Omit<RouterInputs["setup"]["updateQuestion"], "questionId">;
export type SetupDocumentRef = NonNullable<SetupRow["linkedDocument"]>;

/** `forbidden` covers roles without access, so callers can hide setup instead of erroring. */
type LoadStatus = "idle" | "loading" | "ready" | "error" | "forbidden";

let inflight: Promise<void> | null = null;

function isForbidden(error: unknown): boolean {
  return error instanceof TRPCClientError && error.data?.code === "FORBIDDEN";
}

/**
 * The organization's setup board, fetched once and shared by the `/` redirect,
 * the sidebar and the `/setup` page. Kept in localStorage so a returning person
 * sees their board immediately; every page load still refreshes it from the server.
 */
export const useSetupStore = defineStore("setup", {
  state: () => ({
    board: null as SetupBoard | null,
    status: "idle" as LoadStatus,
    loadedAt: null as number | null,
    organizationId: null as string | null,
  }),

  getters: {
    readyCount: (state): number => state.board?.readyCount ?? 0,
    totalCount: (state): number => state.board?.totalCount ?? 0,

    /** Sidebar entry and widget: only while setup has something left to do. */
    showInNav: (state): boolean => {
      const board = state.board;
      if (state.status !== "ready" || !board || board.finishedAt) return false;
      return !board.answeredAt || board.upNext.kind !== "done";
    },
  },

  actions: {
    /**
     * Fetch the board. Concurrent callers share one request; `maxAgeMs` reuses a
     * recent result and `force` always asks the server.
     */
    async load(options: { force?: boolean; maxAgeMs?: number } = {}): Promise<void> {
      const userStore = useUserStore();
      if (!userStore.isAdmin) {
        this.board = null;
        this.status = "forbidden";
        return;
      }

      const sameOrganization = this.organizationId === userStore.activeOrganizationId;
      const fresh =
        this.status === "ready" &&
        sameOrganization &&
        this.loadedAt !== null &&
        Date.now() - this.loadedAt < (options.maxAgeMs ?? Number.POSITIVE_INFINITY);
      if (!options.force && fresh) return;
      if (inflight) return inflight;

      if (!sameOrganization) this.board = null;
      if (!this.board) this.status = "loading";

      inflight = (async () => {
        try {
          this.apply(await Hay.setup.get.query());
        } catch (error) {
          this.board = null;
          this.status = isForbidden(error) ? "forbidden" : "error";
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    },

    /** Take the board a mutation returned. */
    apply(board: SetupBoard) {
      const userStore = useUserStore();
      this.board = board;
      this.status = "ready";
      this.loadedAt = Date.now();
      this.organizationId = userStore.activeOrganizationId;
    },

    reset() {
      this.board = null;
      this.status = "idle";
      this.loadedAt = null;
      this.organizationId = null;
    },
  },

  persist: {
    pick: ["board", "organizationId"],
    // `loadedAt` is not restored, so a restored board always counts as stale.
    afterHydrate: ({ store }) => {
      if (store.board) store.status = "ready";
    },
  },
});
