import { computed, onBeforeUnmount, ref } from "vue";
import { TRPCClientError } from "@trpc/client";
import { Hay } from "@/utils/api";
import type { RouterOutputs } from "@/types/trpc";

export type ReplayReport = RouterOutputs["replays"]["report"];
export type ReplayBucket = ReplayReport["buckets"][number]["bucket"];
type Allowance = RouterOutputs["simulations"]["allowance"];

const POLL_MS = 4000;
/** A sample, not a backfill: setup only needs a first read of how the assistant does. */
export const REPLAY_SAMPLE_CONVERSATIONS = 20;
const REPLAY_TURNS_PER_CONVERSATION = 3;

export type ReplayStartError = "allowance" | "failed" | null;

/**
 * Past conversations for setup: the imported transcripts, the newest replay of them, and its
 * report. Every number comes from the server's replay report; nothing here is estimated.
 */
export function useSetupReplay() {
  const loading = ref(true);
  const loadFailed = ref(false);
  const imported = ref(0);
  const transcriptIds = ref<string[]>([]);
  const allowance = ref<Allowance | null>(null);
  const report = ref<ReplayReport | null>(null);
  const starting = ref(false);
  const startError = ref<ReplayStartError>(null);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const running = computed(
    () => report.value?.run.status === "running" || (report.value?.inProgress ?? 0) > 0,
  );

  const fetchReport = async (runId: string) => {
    try {
      const next = await Hay.replays.report.query({ runId });
      if (stopped) return;
      report.value = next;
    } catch {
      // The next tick tries again; the last report stays on screen.
    }
    if (!stopped && running.value) schedule(runId);
  };

  const schedule = (runId: string) => {
    clear();
    timer = setTimeout(() => {
      timer = null;
      void fetchReport(runId);
    }, POLL_MS);
  };

  const load = async () => {
    loading.value = true;
    loadFailed.value = false;
    try {
      const [transcripts, runs, remaining] = await Promise.all([
        Hay.testTranscripts.list.query({ limit: REPLAY_SAMPLE_CONVERSATIONS }),
        Hay.simulations.list.query({ limit: 20 }),
        Hay.simulations.allowance.query(),
      ]);
      if (stopped) return;
      imported.value = transcripts.total;
      transcriptIds.value = transcripts.items.map((item) => item.id);
      allowance.value = remaining;
      const latest = runs.find((run) => run.kind === "replay");
      if (latest) await fetchReport(latest.id);
    } catch {
      if (!stopped) loadFailed.value = true;
    } finally {
      if (!stopped) loading.value = false;
    }
  };

  const start = async () => {
    if (starting.value || transcriptIds.value.length === 0) return;
    starting.value = true;
    startError.value = null;
    try {
      const run = await Hay.replays.start.mutate({
        transcriptIds: transcriptIds.value,
        maxTurnsPerConversation: REPLAY_TURNS_PER_CONVERSATION,
      });
      if (run) await fetchReport(run.id);
      allowance.value = await Hay.simulations.allowance.query();
    } catch (error) {
      const forbidden = error instanceof TRPCClientError && error.data?.code === "FORBIDDEN";
      startError.value = forbidden ? "allowance" : "failed";
    } finally {
      starting.value = false;
    }
  };

  onBeforeUnmount(() => {
    stopped = true;
    clear();
  });

  return {
    loading,
    loadFailed,
    imported,
    allowance,
    report,
    running,
    starting,
    startError,
    load,
    start,
  };
}
