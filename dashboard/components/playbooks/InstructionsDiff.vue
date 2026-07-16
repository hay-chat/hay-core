<template>
  <div class="rounded-lg border border-border overflow-hidden text-sm font-mono">
    <template v-for="(row, index) in rows" :key="index">
      <button
        v-if="row.kind === 'collapsed'"
        type="button"
        class="w-full px-3 py-1 text-xs text-neutral-muted bg-background-secondary hover:bg-background border-y border-border text-center"
        @click="expand(row.groupIndex)"
      >
        {{ $t("suggest.diff.showHidden", { count: row.count }) }}
      </button>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div
        v-else
        class="px-3 py-0.5 whitespace-pre-wrap break-words diff-line"
        :class="{
          'bg-green-50 text-green-900': row.kind === 'added',
          'bg-red-50 text-red-900 line-through-none': row.kind === 'removed',
          'text-foreground': row.kind === 'context',
        }"
        v-html="row.html"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { diffLines, diffWordsWithSpace } from "diff";
import type { MentionReferences } from "@/utils/markdownToTiptap";

const props = defineProps<{
  currentMarkdown: string;
  revisedMarkdown: string;
  references: MentionReferences;
}>();

const CONTEXT_LINES = 3;
const expandedGroups = ref<Set<number>>(new Set());

function expand(groupIndex: number) {
  expandedGroups.value = new Set([...expandedGroups.value, groupIndex]);
}

type Row =
  | { kind: "context" | "added" | "removed"; html: string }
  | { kind: "collapsed"; count: number; groupIndex: number };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Escape a line and replace `<<action:...>>` / `<<document:...>>` tokens with
 * mention chips so the diff shows readable labels instead of raw tokens.
 */
function lineToHtml(line: string): string {
  const actionMap = new Map(props.references.actions.map((a) => [a.id, a]));
  const documentMap = new Map(props.references.documents.map((d) => [d.id, d]));

  return escapeHtml(line).replace(
    /&lt;&lt;(action|document):([^&]+?)&gt;&gt;/g,
    (_, type: string, payload: string) => {
      if (type === "action") {
        const ref = actionMap.get(payload);
        return `<span class="mention-token mention-action">${escapeHtml(ref ? ref.name : payload)}</span>`;
      }
      const ref = documentMap.get(payload);
      return `<span class="mention-token mention-document">${escapeHtml(ref ? ref.title : payload)}</span>`;
    },
  );
}

/** Intra-line word highlights for a removed/added block pair. */
function wordDiffHtml(oldText: string, newText: string): { oldHtml: string; newHtml: string } {
  const parts = diffWordsWithSpace(oldText, newText);
  let oldHtml = "";
  let newHtml = "";
  for (const part of parts) {
    if (part.added) {
      newHtml += `<mark class="diff-word-added">${lineToHtml(part.value)}</mark>`;
    } else if (part.removed) {
      oldHtml += `<mark class="diff-word-removed">${lineToHtml(part.value)}</mark>`;
    } else {
      oldHtml += lineToHtml(part.value);
      newHtml += lineToHtml(part.value);
    }
  }
  return { oldHtml, newHtml };
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const rows = computed<Row[]>(() => {
  const parts = diffLines(props.currentMarkdown, props.revisedMarkdown);
  const result: Row[] = [];
  let groupIndex = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part.removed && parts[i + 1]?.added) {
      // Paired change: word-level highlighting between the two blocks.
      const next = parts[i + 1];
      const { oldHtml, newHtml } = wordDiffHtml(part.value, next.value);
      for (const line of oldHtml.split("\n")) {
        if (line !== "" || oldHtml === "") result.push({ kind: "removed", html: line || "&nbsp;" });
      }
      for (const line of newHtml.split("\n")) {
        if (line !== "" || newHtml === "") result.push({ kind: "added", html: line || "&nbsp;" });
      }
      i++;
      continue;
    }

    if (part.added || part.removed) {
      for (const line of splitLines(part.value)) {
        result.push({ kind: part.added ? "added" : "removed", html: lineToHtml(line) || "&nbsp;" });
      }
      continue;
    }

    // Unchanged block: collapse long runs, keeping context around changes.
    const lines = splitLines(part.value);
    const isFirst = i === 0;
    const isLast = i === parts.length - 1;
    const leading = isFirst ? 0 : CONTEXT_LINES;
    const trailing = isLast ? 0 : CONTEXT_LINES;
    const currentGroup = groupIndex++;

    if (lines.length > leading + trailing + 4 && !expandedGroups.value.has(currentGroup)) {
      for (const line of lines.slice(0, leading)) {
        result.push({ kind: "context", html: lineToHtml(line) || "&nbsp;" });
      }
      result.push({
        kind: "collapsed",
        count: lines.length - leading - trailing,
        groupIndex: currentGroup,
      });
      for (const line of lines.slice(lines.length - trailing)) {
        result.push({ kind: "context", html: lineToHtml(line) || "&nbsp;" });
      }
    } else {
      for (const line of lines) {
        result.push({ kind: "context", html: lineToHtml(line) || "&nbsp;" });
      }
    }
  }

  return result;
});
</script>

<style scoped>
.diff-line :deep(.mention-token) {
  display: inline-flex;
  align-items: center;
  padding: 0 0.375rem;
  margin: 0 0.125rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.25rem;
  vertical-align: middle;
  font-family: var(--font-sans, sans-serif);
}

.diff-line :deep(.mention-action) {
  background: var(--color-purple-100);
  border: 1px solid var(--color-purple-300);
  color: var(--color-purple-600);
}

.diff-line :deep(.mention-document) {
  background: var(--color-document-100);
  border: 1px solid var(--color-document-300);
  color: var(--color-document-600);
}

.diff-line :deep(.diff-word-added) {
  background: rgb(187 247 208); /* green-200 */
  border-radius: 0.125rem;
}

.diff-line :deep(.diff-word-removed) {
  background: rgb(254 202 202); /* red-200 */
  border-radius: 0.125rem;
}
</style>
