import { ref } from "vue";

const contextStore = ref<Record<string, unknown>>({});

export function addContext(key: string, value: unknown): void {
  contextStore.value = { ...contextStore.value, [key]: value };
}

export function initContext(initial: Record<string, unknown>): void {
  contextStore.value = { ...initial };
}

export function getContext(): Record<string, unknown> {
  return contextStore.value;
}

export { contextStore };
