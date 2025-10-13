import { ref, computed } from "vue";
import { HayApi } from "@/utils/api";

interface Source {
  id: string;
  name: string;
  description: string | null;
  category: string;
  pluginId: string | null;
  isActive: boolean;
  icon: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

const sources = ref<Source[]>([]);
const loading = ref(false);
const error = ref<Error | null>(null);

export function useSources() {
  const loadSources = async () => {
    if (sources.value.length > 0) {
      return sources.value; // Return cached
    }

    loading.value = true;
    error.value = null;

    try {
      const result = await HayApi.sources.list.query();
      sources.value = result.map((source: any) => ({
        ...source,
        createdAt: new Date(source.createdAt),
        updatedAt: new Date(source.updatedAt),
      }));
      return sources.value;
    } catch (err) {
      error.value = err instanceof Error ? err : new Error("Failed to load sources");
      throw error.value;
    } finally {
      loading.value = false;
    }
  };

  const getSourceById = (id: string) => {
    return computed(() => sources.value.find((s) => s.id === id));
  };

  const getSourcesByCategory = (category: string) => {
    return computed(() => sources.value.filter((s) => s.category === category));
  };

  const refreshSources = async () => {
    sources.value = []; // Clear cache
    return loadSources();
  };

  return {
    sources: computed(() => sources.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    loadSources,
    getSourceById,
    getSourcesByCategory,
    refreshSources,
  };
}
