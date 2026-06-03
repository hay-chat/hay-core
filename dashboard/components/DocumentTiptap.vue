<template>
  <div class="document-tiptap">
    <div v-if="editable" class="document-tiptap-toolbar" role="toolbar">
      <button
        type="button"
        :class="['toolbar-btn', { active: isActive('bold') }]"
        :title="$t('documents.editor.bold')"
        @click="run((c: ChainedCommands) => c.toggleBold())"
      >
        <Bold class="h-4 w-4" />
      </button>
      <button
        type="button"
        :class="['toolbar-btn', { active: isActive('italic') }]"
        :title="$t('documents.editor.italic')"
        @click="run((c: ChainedCommands) => c.toggleItalic())"
      >
        <Italic class="h-4 w-4" />
      </button>
      <span class="toolbar-divider" />
      <button
        type="button"
        :class="['toolbar-btn', { active: isActive('heading', { level: 1 }) }]"
        title="H1"
        @click="run((c: ChainedCommands) => c.toggleHeading({ level: 1 }))"
      >
        <Heading1 class="h-4 w-4" />
      </button>
      <button
        type="button"
        :class="['toolbar-btn', { active: isActive('heading', { level: 2 }) }]"
        title="H2"
        @click="run((c: ChainedCommands) => c.toggleHeading({ level: 2 }))"
      >
        <Heading2 class="h-4 w-4" />
      </button>
      <button
        type="button"
        :class="['toolbar-btn', { active: isActive('heading', { level: 3 }) }]"
        title="H3"
        @click="run((c: ChainedCommands) => c.toggleHeading({ level: 3 }))"
      >
        <Heading3 class="h-4 w-4" />
      </button>
      <span class="toolbar-divider" />
      <button
        type="button"
        :class="['toolbar-btn', { active: isActive('bulletList') }]"
        :title="$t('documents.editor.bulletList')"
        @click="run((c: ChainedCommands) => c.toggleBulletList())"
      >
        <List class="h-4 w-4" />
      </button>
      <button
        type="button"
        :class="['toolbar-btn', { active: isActive('orderedList') }]"
        :title="$t('documents.editor.orderedList')"
        @click="run((c: ChainedCommands) => c.toggleOrderedList())"
      >
        <ListOrdered class="h-4 w-4" />
      </button>
      <button
        type="button"
        :class="['toolbar-btn', { active: isActive('blockquote') }]"
        :title="$t('documents.editor.quote')"
        @click="run((c: ChainedCommands) => c.toggleBlockquote())"
      >
        <Quote class="h-4 w-4" />
      </button>
      <span class="toolbar-divider" />
      <button
        type="button"
        :class="['toolbar-btn', { active: isActive('link') }]"
        :title="$t('documents.editor.externalLink')"
        @click="promptExternalLink"
      >
        <LinkIcon class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="toolbar-btn"
        :title="$t('documents.editor.internalLink')"
        @click="openInternalLinkPicker"
      >
        <FileSymlink class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="toolbar-btn"
        :title="$t('documents.editor.image')"
        :disabled="uploadingImage"
        @click="triggerImageUpload"
      >
        <ImageIcon class="h-4 w-4" />
      </button>
      <input
        ref="fileInputRef"
        type="file"
        accept="image/*"
        class="hidden"
        @change="onImageSelected"
      />
    </div>

    <editor-content :editor="editor" class="document-tiptap-content" />

    <Dialog :open="internalLinkOpen" @update:open="internalLinkOpen = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ $t("documents.editor.linkToDocument") }}</DialogTitle>
        </DialogHeader>
        <Input
          v-model="internalLinkSearch"
          :placeholder="$t('documents.editor.searchDocuments')"
          @keyup="searchInternalDocs"
        />
        <div class="max-h-72 overflow-y-auto mt-2">
          <button
            v-for="doc in internalLinkResults"
            :key="doc.id"
            type="button"
            class="w-full text-left px-3 py-2 rounded hover:bg-muted"
            @click="insertInternalLink(doc)"
          >
            <div class="font-medium text-sm">{{ doc.title || "Untitled" }}</div>
            <div v-if="doc.description" class="text-xs text-neutral-muted">
              {{ doc.description }}
            </div>
          </button>
          <div
            v-if="!internalLinkResults.length && !searchingInternal"
            class="text-sm text-neutral-muted px-3 py-4 text-center"
          >
            {{ $t("documents.editor.noResults") }}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { Editor, EditorContent } from "@tiptap/vue-3";
import type { JSONContent, ChainedCommands } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  FileSymlink,
  Image as ImageIcon,
} from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import Dialog from "@/components/ui/Dialog.vue";
import DialogContent from "@/components/ui/DialogContent.vue";
import DialogHeader from "@/components/ui/DialogHeader.vue";
import DialogTitle from "@/components/ui/DialogTitle.vue";
import Input from "@/components/ui/Input.vue";

interface Props {
  content?: JSONContent;
  placeholder?: string;
  editable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  content: undefined,
  placeholder: "Start writing your document...",
  editable: true,
});

const emit = defineEmits<{
  update: [payload: { json: JSONContent; html: string }];
}>();

const editor = ref<Editor>();
const fileInputRef = ref<HTMLInputElement | null>(null);
const uploadingImage = ref(false);

const internalLinkOpen = ref(false);
const internalLinkSearch = ref("");
const internalLinkResults = ref<Array<{ id: string; title: string; description?: string }>>([]);
const searchingInternal = ref(false);

const initEditor = () => {
  editor.value = new Editor({
    editable: props.editable,
    content: props.content ?? { type: "doc", content: [] },
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { HTMLAttributes: { class: "list-disc list-inside" } },
        orderedList: { HTMLAttributes: { class: "list-decimal list-inside" } },
      }),
      Placeholder.configure({ placeholder: props.placeholder }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        protocols: ["http", "https", "mailto"],
        HTMLAttributes: {
          rel: "noopener noreferrer",
          class: "tiptap-link",
        },
      }),
      Image.configure({
        inline: false,
        HTMLAttributes: { class: "tiptap-image" },
      }),
    ],
    onUpdate: ({ editor }) => {
      emit("update", { json: editor.getJSON(), html: editor.getHTML() });
    },
    editorProps: {
      attributes: { class: "tiptap-editor-content" },
    },
  });
};

const isActive = (name: string, attrs?: Record<string, unknown>) =>
  !!editor.value?.isActive(name, attrs);

const run = (cb: (chain: ChainedCommands) => ChainedCommands) => {
  if (!editor.value) return;
  cb(editor.value.chain().focus()).run();
};

const promptExternalLink = () => {
  if (!editor.value) return;
  const previous = editor.value.getAttributes("link").href as string | undefined;
  const url = window.prompt("URL", previous || "https://");
  if (url === null) return;
  if (url === "") {
    editor.value.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }
  if (!/^https?:\/\//i.test(url) && !url.startsWith("mailto:")) {
    return;
  }
  editor.value.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
};

const openInternalLinkPicker = async () => {
  internalLinkOpen.value = true;
  internalLinkSearch.value = "";
  await searchInternalDocs();
};

let searchTimeout: ReturnType<typeof setTimeout> | null = null;
const searchInternalDocs = async () => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    searchingInternal.value = true;
    try {
      const query = internalLinkSearch.value.trim();
      if (query) {
        const results = await HayApi.documents.search.query({ query, limit: 20 });
        internalLinkResults.value = results.map((r) => ({
          id: r.id,
          title: r.title,
          description: r.description,
        }));
      } else {
        const list = await HayApi.documents.list.query({ pagination: { page: 1, limit: 20 } });
        internalLinkResults.value = (list.items || []).map(
          (r: { id: string; title?: string; description?: string }) => ({
            id: r.id,
            title: r.title || "Untitled",
            description: r.description,
          }),
        );
      }
    } catch (err) {
      console.error("Failed to search documents:", err);
      internalLinkResults.value = [];
    } finally {
      searchingInternal.value = false;
    }
  }, 200);
};

const insertInternalLink = (doc: { id: string; title: string }) => {
  if (!editor.value) return;
  const href = `/documents/${doc.id}`;
  const { from, to, empty } = editor.value.state.selection;
  if (empty) {
    editor.value
      .chain()
      .focus()
      .insertContent({
        type: "text",
        text: doc.title,
        marks: [{ type: "link", attrs: { href } }],
      })
      .run();
  } else {
    editor.value
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href })
      .setTextSelection({ from, to })
      .run();
  }
  internalLinkOpen.value = false;
};

const triggerImageUpload = () => fileInputRef.value?.click();

const onImageSelected = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = "";
  if (!file || !editor.value) return;

  uploadingImage.value = true;
  try {
    const fileBuffer = await readFileAsBase64(file);
    const { url } = await HayApi.documents.uploadImage.mutate({
      fileBuffer,
      mimeType: file.type,
      fileName: file.name,
    });
    editor.value.chain().focus().setImage({ src: url, alt: file.name }).run();
  } catch (err) {
    console.error("Image upload failed:", err);
  } finally {
    uploadingImage.value = false;
  }
};

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

watch(
  () => props.content,
  (next) => {
    if (!editor.value || !next) return;
    const current = editor.value.getJSON();
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      editor.value.commands.setContent(next, false);
    }
  },
  { deep: true },
);

watch(
  () => props.editable,
  (val) => editor.value?.setEditable(val),
);

onMounted(initEditor);
onUnmounted(() => editor.value?.destroy());

defineExpose({
  getJSON: () => editor.value?.getJSON() || null,
  getHTML: () => editor.value?.getHTML() || "",
});
</script>

<style>
.document-tiptap {
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  background: var(--color-background);
  display: flex;
  flex-direction: column;
}

.document-tiptap-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.125rem;
  padding: 0.375rem;
  border-bottom: 1px solid var(--color-border);
  border-top-left-radius: calc(0.5rem + 1px);
  border-top-right-radius: calc(0.5rem + 1px);
  background: var(--color-background-secondary, transparent);
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1.75rem;
  width: 1.75rem;
  border-radius: 0.25rem;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-foreground);
}

.toolbar-btn:hover {
  background: var(--color-muted);
}

.toolbar-btn.active {
  background: var(--color-muted);
  color: var(--color-primary);
}

.toolbar-btn[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolbar-divider {
  width: 1px;
  height: 1rem;
  background: var(--color-border);
  margin: 0 0.25rem;
}

.document-tiptap-content {
  padding: 1rem 1.25rem;
  min-height: 320px;
}

.document-tiptap .tiptap-editor-content {
  outline: none;
  min-height: 320px;
}

.document-tiptap .tiptap-editor-content p.is-editor-empty:first-child::before {
  color: var(--color-neutral-muted);
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}

.document-tiptap .tiptap-editor-content h1 {
  font-size: 1.875rem;
  font-weight: 700;
  margin: 1rem 0 0.5rem;
}
.document-tiptap .tiptap-editor-content h2 {
  font-size: 1.5rem;
  font-weight: 600;
  margin: 0.875rem 0 0.5rem;
}
.document-tiptap .tiptap-editor-content h3 {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0.75rem 0 0.5rem;
}
.document-tiptap .tiptap-editor-content p {
  margin: 0 0 0.5rem;
}
.document-tiptap .tiptap-editor-content blockquote {
  border-left: 3px solid var(--color-border);
  padding-left: 0.75rem;
  color: var(--color-neutral-muted);
  margin: 0.5rem 0;
}
.document-tiptap .tiptap-editor-content ul,
.document-tiptap .tiptap-editor-content ol {
  padding-left: 1.5rem;
  margin: 0.5rem 0;
}
.document-tiptap .tiptap-link {
  color: var(--color-primary);
  text-decoration: underline;
  cursor: pointer;
}
.document-tiptap .tiptap-image {
  max-width: 100%;
  height: auto;
  border-radius: 0.375rem;
  margin: 0.5rem 0;
}
</style>
