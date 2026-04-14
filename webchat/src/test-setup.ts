import { beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

// Reset web-storage and IndexedDB between tests so each case runs against a
// clean slate.
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  // Replace the global indexedDB with a fresh factory — this is the official
  // fake-indexeddb pattern for per-test isolation.
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});
