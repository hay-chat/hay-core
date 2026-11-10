<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm text-neutral-muted">{{ $t("helpCenter.content.intro") }}</p>
      <Button @click="openCollectionDialog(null)">
        <Plus class="mr-2 h-4 w-4" />
        {{ $t("helpCenter.content.newCollection") }}
      </Button>
    </div>

    <div v-if="loadFailed" class="space-y-2" role="alert" data-testid="collections-load-error">
      <p class="text-sm text-destructive">{{ $t("helpCenter.content.loadFailed") }}</p>
      <Button variant="outline" size="sm" @click="emit('changed')">
        {{ $t("helpCenter.tryAgain") }}
      </Button>
    </div>

    <Card v-else-if="items.length === 0">
      <CardContent class="pt-6">
        <EmptyState
          :title="$t('helpCenter.content.emptyTitle')"
          :description="$t('helpCenter.content.emptyDescription')"
          :action="$t('helpCenter.content.newCollection')"
          @click="openCollectionDialog(null)"
        />
      </CardContent>
    </Card>

    <Card
      v-for="(collection, index) in items"
      :key="collection.id"
      :data-testid="`collection-${collection.id}`"
    >
      <CardHeader>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex min-w-0 items-start gap-3">
            <span v-if="collection.icon" class="text-2xl leading-none" aria-hidden="true">
              {{ collection.icon }}
            </span>
            <div class="min-w-0">
              <CardTitle>{{ collection.title }}</CardTitle>
              <CardDescription v-if="collection.description">
                {{ collection.description }}
              </CardDescription>
              <p class="mt-1 text-sm text-neutral-muted">
                {{
                  $t(
                    "helpCenter.content.articleCount",
                    { count: collection.articles.length },
                    collection.articles.length,
                  )
                }}
              </p>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              :disabled="busy || index === 0"
              :aria-label="$t('helpCenter.content.moveCollectionUp', { title: collection.title })"
              @click="moveCollection(index, -1)"
            >
              <ArrowUp class="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              :disabled="busy || index === items.length - 1"
              :aria-label="$t('helpCenter.content.moveCollectionDown', { title: collection.title })"
              @click="moveCollection(index, 1)"
            >
              <ArrowDown class="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              :disabled="busy"
              :aria-label="$t('helpCenter.content.editCollection', { title: collection.title })"
              @click="openCollectionDialog(collection)"
            >
              <Pencil class="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-destructive hover:text-destructive"
              :disabled="busy"
              :aria-label="$t('helpCenter.content.deleteCollection', { title: collection.title })"
              @click="deleting = collection"
            >
              <Trash2 class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-3">
        <p v-if="collection.articles.length === 0" class="text-sm text-neutral-muted">
          {{ $t("helpCenter.content.noArticles") }}
        </p>
        <ol v-else class="divide-y rounded-md border">
          <li
            v-for="(article, articleIndex) in collection.articles"
            :key="article.documentId"
            class="flex flex-wrap items-center gap-2 px-3 py-2"
          >
            <NuxtLink
              :to="`/documents/${article.documentId}`"
              class="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
            >
              {{ article.title || $t("helpCenter.untitled") }}
            </NuxtLink>
            <Badge v-if="!article.live" variant="warning">
              {{ $t(`helpCenter.content.notLive.${notLiveReason(article)}`) }}
            </Badge>
            <div class="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                :disabled="busy || articleIndex === 0"
                :aria-label="$t('helpCenter.content.moveArticleUp', { title: article.title })"
                @click="moveArticle(collection, articleIndex, -1)"
              >
                <ArrowUp class="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                :disabled="busy || articleIndex === collection.articles.length - 1"
                :aria-label="$t('helpCenter.content.moveArticleDown', { title: article.title })"
                @click="moveArticle(collection, articleIndex, 1)"
              >
                <ArrowDown class="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                :disabled="busy"
                :aria-label="$t('helpCenter.content.removeArticle', { title: article.title })"
                @click="removeArticle(collection, article.documentId)"
              >
                <X class="h-4 w-4" />
              </Button>
            </div>
          </li>
        </ol>
        <Button variant="outline" size="sm" :disabled="busy" @click="openAddDialog(collection)">
          <Plus class="mr-1 h-4 w-4" />
          {{ $t("helpCenter.content.addArticles") }}
        </Button>
      </CardContent>
    </Card>

    <!-- New / edit collection -->
    <Dialog :open="collectionDialogOpen" @update:open="collectionDialogOpen = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {{
              editingId
                ? $t("helpCenter.content.editCollectionTitle")
                : $t("helpCenter.content.newCollection")
            }}
          </DialogTitle>
          <DialogDescription>{{ $t("helpCenter.content.collectionDialogHint") }}</DialogDescription>
        </DialogHeader>
        <HelpCenterCollectionFields v-model="collectionDraft" />
        <DialogFooter>
          <Button variant="outline" :disabled="busy" @click="collectionDialogOpen = false">
            {{ $t("helpCenter.cancel") }}
          </Button>
          <Button
            :loading="busy"
            :disabled="!collectionDraft.title.trim()"
            data-testid="save-collection"
            @click="saveCollection"
          >
            {{ editingId ? $t("helpCenter.saveChanges") : $t("helpCenter.content.create") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Add articles -->
    <Dialog :open="addingTo !== null" size="lg" @update:open="closeAddDialog">
      <DialogContent v-if="addingTo">
        <DialogHeader>
          <DialogTitle>
            {{ $t("helpCenter.articles.addTitle", { collection: addingTo.title }) }}
          </DialogTitle>
          <DialogDescription>{{ $t("helpCenter.articles.addDescription") }}</DialogDescription>
        </DialogHeader>
        <HelpCenterDocumentPicker
          v-model="pickedIds"
          :fixed-ids="addingTo.articles.map((article) => article.documentId)"
          :placements="placementsOutside(addingTo.id)"
        />
        <p
          v-if="pickedIds.length > 0"
          class="text-sm text-amber-700"
          role="note"
          data-testid="public-notice"
        >
          {{ $t("helpCenter.articles.publicNotice", { count: pickedIds.length }) }}
        </p>
        <DialogFooter>
          <Button variant="outline" :disabled="busy" @click="closeAddDialog(false)">
            {{ $t("helpCenter.cancel") }}
          </Button>
          <Button
            :loading="busy"
            :disabled="pickedIds.length === 0"
            data-testid="confirm-add-articles"
            @click="addArticles"
          >
            {{
              $t("helpCenter.articles.addConfirm", { count: pickedIds.length }, pickedIds.length)
            }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <ConfirmDialog
      :open="deleting !== null"
      :title="$t('helpCenter.content.deleteTitle', { title: deleting?.title ?? '' })"
      :description="$t('helpCenter.content.deleteDescription')"
      :confirm-text="$t('helpCenter.content.deleteConfirm')"
      :destructive="true"
      :loading="busy"
      @update:open="!$event && (deleting = null)"
      @confirm="deleteCollection"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import {
  errorMessage,
  moved,
  type HelpCenterArticle,
  type HelpCenterCollection,
  type HelpCenterCollectionDraft,
} from "@/utils/help-center";
import HelpCenterCollectionFields from "./HelpCenterCollectionFields.vue";
import HelpCenterDocumentPicker from "./HelpCenterDocumentPicker.vue";

const props = defineProps<{ collections: HelpCenterCollection[]; loadFailed?: boolean }>();
/** Something was saved (or a retry was asked for): the page reloads the collections. */
const emit = defineEmits<{ changed: [] }>();

const { t } = useI18n();
const toast = useToast();

// A local copy, so a reorder shows at once; the server's answer replaces it.
const items = ref<HelpCenterCollection[]>(props.collections);
watch(
  () => props.collections,
  (collections) => (items.value = collections),
);

/** One change at a time: every save sends a full ordered list. */
const busy = ref(false);

/** Runs one save; on failure says why and puts the server's state back. */
async function save(action: () => Promise<unknown>): Promise<boolean> {
  busy.value = true;
  try {
    await action();
    return true;
  } catch (error) {
    console.error("Failed to save help center content:", error);
    toast.error(t("helpCenter.saveFailed"), errorMessage(error));
    items.value = props.collections;
    return false;
  } finally {
    busy.value = false;
    emit("changed");
  }
}

function notLiveReason(article: HelpCenterArticle): "draft" | "unpublished" | "notPublic" {
  if (article.status === "draft") return "draft";
  return article.status === "published" ? "notPublic" : "unpublished";
}

// --- Collections ---
async function moveCollection(index: number, direction: -1 | 1) {
  items.value = moved(items.value, index, direction);
  const ids = items.value.map((collection) => collection.id);
  await save(() => Hay.helpCenter.reorderCollections.mutate({ ids }));
}

const collectionDialogOpen = ref(false);
const editingId = ref<string | null>(null);
const collectionDraft = ref<HelpCenterCollectionDraft>({ title: "", description: "", icon: "" });

function openCollectionDialog(collection: HelpCenterCollection | null) {
  editingId.value = collection?.id ?? null;
  collectionDraft.value = {
    title: collection?.title ?? "",
    description: collection?.description ?? "",
    icon: collection?.icon ?? "",
  };
  collectionDialogOpen.value = true;
}

async function saveCollection() {
  const fields = {
    title: collectionDraft.value.title.trim(),
    description: collectionDraft.value.description.trim() || null,
    icon: collectionDraft.value.icon.trim() || null,
  };
  const id = editingId.value;
  const saved = await save(() =>
    id
      ? Hay.helpCenter.updateCollection.mutate({ id, ...fields })
      : Hay.helpCenter.createCollection.mutate(fields),
  );
  if (saved) collectionDialogOpen.value = false;
}

const deleting = ref<HelpCenterCollection | null>(null);

async function deleteCollection() {
  const id = deleting.value?.id;
  if (!id) return;
  if (await save(() => Hay.helpCenter.deleteCollection.mutate({ id }))) {
    toast.success(t("helpCenter.content.deleted"), t("helpCenter.content.stillPublicHint"));
  }
  deleting.value = null;
}

// --- Articles ---
function setArticles(collection: HelpCenterCollection, articles: HelpCenterArticle[]) {
  items.value = items.value.map((item) =>
    item.id === collection.id ? { ...item, articles } : item,
  );
  return save(() =>
    Hay.helpCenter.setCollectionArticles.mutate({
      collectionId: collection.id,
      documentIds: articles.map((article) => article.documentId),
    }),
  );
}

function moveArticle(collection: HelpCenterCollection, index: number, direction: -1 | 1) {
  return setArticles(collection, moved(collection.articles, index, direction));
}

async function removeArticle(collection: HelpCenterCollection, documentId: string) {
  const remaining = collection.articles.filter((article) => article.documentId !== documentId);
  if (await setArticles(collection, remaining)) {
    toast.success(t("helpCenter.content.articleRemoved"), t("helpCenter.content.stillPublicHint"));
  }
}

const addingTo = ref<HelpCenterCollection | null>(null);
const pickedIds = ref<string[]>([]);

function openAddDialog(collection: HelpCenterCollection) {
  pickedIds.value = [];
  addingTo.value = collection;
}

function closeAddDialog(open: boolean) {
  if (!open && !busy.value) addingTo.value = null;
}

/** Where each document outside this collection already sits, by document id. */
function placementsOutside(collectionId: string): Record<string, string> {
  return Object.fromEntries(
    items.value
      .filter((collection) => collection.id !== collectionId)
      .flatMap((collection) =>
        collection.articles.map((article) => [article.documentId, collection.title]),
      ),
  );
}

async function addArticles() {
  const collection = addingTo.value;
  if (!collection) return;
  const documentIds = [
    ...collection.articles.map((article) => article.documentId),
    ...pickedIds.value,
  ];
  const saved = await save(() =>
    Hay.helpCenter.setCollectionArticles.mutate({ collectionId: collection.id, documentIds }),
  );
  if (saved) {
    toast.success(t("helpCenter.articles.added"));
    addingTo.value = null;
  }
}
</script>
