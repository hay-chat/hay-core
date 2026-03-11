<template>
  <Page :title="$t('apiTokens.title')" :description="$t('apiTokens.description')">
    <template #header>
      <Button variant="default" size="sm" @click="openCreateDialog">
        <Plus class="h-4 w-4 mr-2" />
        {{ $t('apiTokens.createToken') }}
      </Button>
    </template>

    <!-- Tokens List -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t('apiTokens.apiTokens') }}</CardTitle>
        <CardDescription>
          {{ $t('apiTokens.apiTokensDescription') }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <!-- Empty State -->
        <div
          v-if="!loading && tokens.length === 0"
          class="text-center py-12 border-2 border-dashed border-muted rounded-lg"
        >
          <Key class="h-12 w-12 text-neutral-muted mx-auto mb-4" />
          <h3 class="text-lg font-medium mb-2">{{ $t('apiTokens.noTokensTitle') }}</h3>
          <p class="text-sm text-neutral-muted mb-4">
            {{ $t('apiTokens.noTokensDescription') }}
          </p>
          <Button @click="openCreateDialog">
            <Plus class="h-4 w-4 mr-2" />
            {{ $t('apiTokens.createToken') }}
          </Button>
        </div>

        <!-- Tokens Table -->
        <div v-else class="space-y-3">
          <div
            v-for="token in tokens"
            :key="token.id"
            class="flex items-center justify-between p-4 border rounded-lg hover:bg-background-secondary transition-colors"
          >
            <div class="flex-1">
              <div class="flex items-center gap-3 mb-2">
                <h4 class="font-medium">{{ token.name }}</h4>
                <Badge :variant="token.isActive ? 'success' : 'secondary'">
                  {{ token.isActive ? $t('apiTokens.active') : $t('apiTokens.inactive') }}
                </Badge>
                <Badge v-if="isExpired(token)" variant="destructive">{{ $t('apiTokens.expired') }}</Badge>
              </div>

              <div class="font-mono text-xs bg-background-tertiary px-3 py-1.5 rounded inline-block mb-2">
                {{ token.maskedKey }}
              </div>

              <div class="flex items-center gap-4 text-sm text-neutral-muted">
                <span>{{ $t('apiTokens.created', { date: formatDate(token.createdAt) }) }}</span>
                <span v-if="token.lastUsedAt">{{ $t('apiTokens.lastUsed', { date: formatDate(token.lastUsedAt) }) }}</span>
                <span v-else>{{ $t('apiTokens.neverUsed') }}</span>
                <span v-if="token.expiresAt">{{ $t('apiTokens.expires', { date: formatDate(token.expiresAt) }) }}</span>
              </div>

              <!-- Scopes -->
              <div v-if="token.scopes && token.scopes.length > 0" class="mt-2 flex flex-wrap gap-1">
                <Badge v-for="scope in token.scopes.slice(0, 5)" :key="scope" variant="outline" class="text-xs">
                  {{ scope }}
                </Badge>
                <Badge v-if="token.scopes.length > 5" variant="outline" class="text-xs">
                  {{ $t('apiTokens.moreScopes', { count: token.scopes.length - 5 }) }}
                </Badge>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-2">
              <Button variant="ghost" size="sm" @click="openEditDialog(token)">
                <Edit class="h-4 w-4" />
              </Button>
              <Button
                v-if="token.isActive"
                variant="ghost"
                size="sm"
                @click="revokeToken(token.id)"
              >
                <Ban class="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" @click="deleteToken(token.id)">
                <Trash2 class="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Create Token Dialog -->
    <Dialog v-model:open="createDialogOpen">
      <DialogContent class="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{{ $t('apiTokens.createDialogTitle') }}</DialogTitle>
          <DialogDescription>
            {{ $t('apiTokens.createDialogDescription') }}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <!-- Token Name -->
          <div>
            <Label for="token-name">{{ $t('apiTokens.tokenName') }}</Label>
            <Input
              id="token-name"
              v-model="newToken.name"
              :placeholder="$t('apiTokens.tokenNamePlaceholder')"
              class="mt-1"
            />
          </div>

          <!-- Expiration Date (Optional) -->
          <div>
            <Label for="token-expiry">{{ $t('apiTokens.expirationDate') }}</Label>
            <Input
              id="token-expiry"
              v-model="newToken.expiresAt"
              type="date"
              class="mt-1"
            />
            <p class="text-xs text-neutral-muted mt-1">{{ $t('apiTokens.noExpiration') }}</p>
          </div>

          <!-- Scopes -->
          <div>
            <Label>{{ $t('apiTokens.scopes') }}</Label>
            <p class="text-xs text-neutral-muted mb-3">
              {{ $t('apiTokens.scopesDescription') }}
            </p>

            <div class="space-y-4">
              <div v-for="(scopes, group) in scopeGroups" :key="group" class="space-y-2">
                <h4 class="font-medium text-sm">{{ group }}</h4>
                <div class="grid grid-cols-2 gap-2 pl-4">
                  <label
                    v-for="scope in scopes"
                    :key="scope.value"
                    class="flex items-center space-x-2 cursor-pointer"
                  >
                    <Checkbox
                      :id="`scope-${scope.value}`"
                      :checked="newToken.scopes.includes(scope.value)"
                      @update:checked="toggleScope(scope.value)"
                    />
                    <span class="text-sm">{{ scope.label }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="createDialogOpen = false">{{ $t('apiTokens.cancel') }}</Button>
          <Button
            :loading="creating"
            :disabled="!newToken.name || creating"
            @click="createToken"
          >
            {{ $t('apiTokens.generateToken') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Show Token Dialog (Once) -->
    <Dialog v-model:open="showTokenDialogOpen">
      <DialogContent class="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{{ $t('apiTokens.yourApiToken') }}</DialogTitle>
          <DialogDescription>
            {{ $t('apiTokens.copyTokenWarning') }}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <Alert variant="warning">
            <AlertTriangle class="h-4 w-4" />
            <AlertTitle>{{ $t('apiTokens.importantWarning') }}</AlertTitle>
            <AlertDescription>
              {{ $t('apiTokens.importantWarningDescription') }}
            </AlertDescription>
          </Alert>

          <div class="relative">
            <Input
              ref="tokenInput"
              :value="createdToken"
              readonly
              class="font-mono pr-20"
              @click="selectToken"
            />
            <Button
              variant="ghost"
              size="sm"
              class="absolute right-1 top-1"
              @click="copyToken"
            >
              <Copy class="h-4 w-4" />
              {{ copied ? $t('apiTokens.copied') : $t('apiTokens.copy') }}
            </Button>
          </div>

          <div v-if="createdTokenScopes.length > 0" class="space-y-2">
            <Label>{{ $t('apiTokens.tokenScopes') }}</Label>
            <div class="flex flex-wrap gap-1">
              <Badge v-for="scope in createdTokenScopes" :key="scope" variant="outline">
                {{ scope }}
              </Badge>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button @click="closeTokenDialog">{{ $t('apiTokens.done') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Edit Token Dialog -->
    <Dialog v-model:open="editDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ $t('apiTokens.editDialogTitle') }}</DialogTitle>
          <DialogDescription>{{ $t('apiTokens.editDialogDescription') }}</DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <div>
            <Label for="edit-token-name">{{ $t('apiTokens.tokenNameLabel') }}</Label>
            <Input
              id="edit-token-name"
              v-model="editingToken.name"
              :placeholder="$t('apiTokens.tokenNameEditPlaceholder')"
              class="mt-1"
            />
          </div>

          <!-- Scopes -->
          <div>
            <Label>{{ $t('apiTokens.scopes') }}</Label>
            <div class="space-y-4 mt-2">
              <div v-for="(scopes, group) in scopeGroups" :key="group" class="space-y-2">
                <h4 class="font-medium text-sm">{{ group }}</h4>
                <div class="grid grid-cols-2 gap-2 pl-4">
                  <label
                    v-for="scope in scopes"
                    :key="scope.value"
                    class="flex items-center space-x-2 cursor-pointer"
                  >
                    <Checkbox
                      :id="`edit-scope-${scope.value}`"
                      :checked="editingToken.scopes?.includes(scope.value)"
                      @update:checked="toggleEditScope(scope.value)"
                    />
                    <span class="text-sm">{{ scope.label }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="editDialogOpen = false">{{ $t('apiTokens.cancel') }}</Button>
          <Button :loading="updating" @click="updateToken">{{ $t('apiTokens.saveChanges') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Page>
</template>

<script setup lang="ts">
import { Plus, Key, Edit, Trash2, Ban, Copy, AlertTriangle } from "lucide-vue-next";
import { Hay } from "@/utils/api";

const { t } = useI18n();

// State
const loading = ref(false);
const creating = ref(false);
const updating = ref(false);
const tokens = ref<any[]>([]);
const createDialogOpen = ref(false);
const showTokenDialogOpen = ref(false);
const editDialogOpen = ref(false);
const createdToken = ref("");
const createdTokenScopes = ref<string[]>([]);
const copied = ref(false);
const tokenInput = ref<HTMLInputElement | null>(null);

const newToken = ref({
  name: "",
  scopes: [] as string[],
  expiresAt: "",
});

const editingToken = ref<any>({
  id: "",
  name: "",
  scopes: [] as string[],
});

// Scope groups for UI
const scopeGroups = {
  "Conversations & Messages": [
    { label: "Read Conversations", value: "conversations:read" },
    { label: "Write Conversations", value: "conversations:write" },
    { label: "Read Messages", value: "messages:read" },
    { label: "Write Messages", value: "messages:write" },
  ],
  Customers: [
    { label: "Read Customers", value: "customers:read" },
    { label: "Write Customers", value: "customers:write" },
  ],
  Content: [
    { label: "Read Documents", value: "documents:read" },
    { label: "Write Documents", value: "documents:write" },
    { label: "Read Agents", value: "agents:read" },
    { label: "Read Playbooks", value: "playbooks:read" },
  ],
  Analytics: [{ label: "Read Analytics", value: "analytics:read" }],
  "Privacy & DSAR": [
    { label: "Read Privacy Requests", value: "privacy:read" },
    { label: "Write Privacy Requests", value: "privacy:write" },
    { label: "Export User Data", value: "privacy:export" },
    { label: "Delete User Data", value: "privacy:delete" },
  ],
  Settings: [
    { label: "Read Settings", value: "settings:read" },
    { label: "Write Settings", value: "settings:write" },
  ],
  "Full Access": [{ label: "All Permissions", value: "*:*" }],
};

// Methods
const loadTokens = async () => {
  loading.value = true;
  try {
    tokens.value = await Hay.apiTokens.list.query();
  } catch (error) {
    console.error("Failed to load tokens:", error);
  } finally {
    loading.value = false;
  }
};

const openCreateDialog = () => {
  newToken.value = {
    name: "",
    scopes: [],
    expiresAt: "",
  };
  createDialogOpen.value = true;
};

const toggleScope = (scope: string) => {
  const index = newToken.value.scopes.indexOf(scope);
  if (index > -1) {
    newToken.value.scopes.splice(index, 1);
  } else {
    newToken.value.scopes.push(scope);
  }
};

const toggleEditScope = (scope: string) => {
  if (!editingToken.value.scopes) {
    editingToken.value.scopes = [];
  }
  const index = editingToken.value.scopes.indexOf(scope);
  if (index > -1) {
    editingToken.value.scopes.splice(index, 1);
  } else {
    editingToken.value.scopes.push(scope);
  }
};

const createToken = async () => {
  creating.value = true;
  try {
    const result = await Hay.apiTokens.create.mutate({
      name: newToken.value.name,
      scopes: newToken.value.scopes as any,
      expiresAt: newToken.value.expiresAt ? new Date(newToken.value.expiresAt) : undefined,
    });

    createdToken.value = result.token;
    createdTokenScopes.value = result.scopes;
    createDialogOpen.value = false;
    showTokenDialogOpen.value = true;

    // Reload tokens list
    await loadTokens();
  } catch (error) {
    console.error("Failed to create token:", error);
  } finally {
    creating.value = false;
  }
};

const selectToken = () => {
  tokenInput.value?.select();
};

const copyToken = async () => {
  try {
    await navigator.clipboard.writeText(createdToken.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch (error) {
    console.error("Failed to copy token:", error);
  }
};

const closeTokenDialog = () => {
  showTokenDialogOpen.value = false;
  createdToken.value = "";
  createdTokenScopes.value = [];
  copied.value = false;
};

const openEditDialog = (token: any) => {
  editingToken.value = {
    id: token.id,
    name: token.name,
    scopes: [...token.scopes],
  };
  editDialogOpen.value = true;
};

const updateToken = async () => {
  updating.value = true;
  try {
    await Hay.apiTokens.update.mutate({
      id: editingToken.value.id,
      name: editingToken.value.name,
      scopes: editingToken.value.scopes as any,
    });

    editDialogOpen.value = false;
    await loadTokens();
  } catch (error) {
    console.error("Failed to update token:", error);
  } finally {
    updating.value = false;
  }
};

const revokeToken = async (id: string) => {
  if (!confirm(t('apiTokens.revokeConfirm'))) {
    return;
  }

  try {
    await Hay.apiTokens.revoke.mutate({ id });
    await loadTokens();
  } catch (error) {
    console.error("Failed to revoke token:", error);
  }
};

const deleteToken = async (id: string) => {
  if (!confirm(t('apiTokens.deleteConfirm'))) {
    return;
  }

  try {
    await Hay.apiTokens.delete.mutate({ id });
    await loadTokens();
  } catch (error) {
    console.error("Failed to delete token:", error);
  }
};

const formatDate = (date: Date | string) => {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;

  return d.toLocaleDateString();
};

const isExpired = (token: any) => {
  if (!token.expiresAt) return false;
  return new Date(token.expiresAt) < new Date();
};

// Lifecycle
onMounted(() => {
  loadTokens();
});

// Page meta
definePageMeta({
  layout: "default",
});

// Head
useHead({
  title: t('apiTokens.headTitle'),
  meta: [
    {
      name: "description",
      content: t('apiTokens.headDescription'),
    },
  ],
});
</script>
