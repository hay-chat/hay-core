import { describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";
import { useNewRows } from "@/composables/useNewRows";

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

function setup(initial?: { id: string }[]) {
  const list = ref<{ id: string }[] | undefined>(initial);
  const key = ref<string | null>("page-1");
  return { list, key, isNew: useNewRows(list, key) };
}

describe("useNewRows", () => {
  it("marks nothing on the first load", async () => {
    const { list, isNew } = setup();

    list.value = rows("a", "b");
    await nextTick();

    expect(isNew("a")).toBe(false);
    expect(isNew("b")).toBe(false);
  });

  it("marks only rows added by a refetch of the same list", async () => {
    const { list, isNew } = setup(rows("a"));

    list.value = rows("b", "a");
    await nextTick();

    expect(isNew("b")).toBe(true);
    expect(isNew("a")).toBe(false);
  });

  it("marks nothing when a refetch returns the same rows", async () => {
    const { list, isNew } = setup(rows("a"));

    list.value = rows("b", "a");
    await nextTick();
    list.value = rows("b", "a");
    await nextTick();

    expect(isNew("b")).toBe(false);
  });

  it("marks nothing when the filter or page changes", async () => {
    const { list, key, isNew } = setup(rows("a"));

    key.value = "page-2";
    list.value = rows("z");
    await nextTick();

    expect(isNew("z")).toBe(false);
  });

  it("marks nothing when a different list arrives after loading", async () => {
    const { list, key, isNew } = setup(rows("a"));

    key.value = "page-2";
    list.value = undefined;
    await nextTick();
    list.value = rows("z");
    await nextTick();

    expect(isNew("z")).toBe(false);
  });
});
