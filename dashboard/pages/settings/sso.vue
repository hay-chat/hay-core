<template>
  <Page :title="$t('sso.title')" :description="$t('sso.description')">
    <SettingsTabs />

    <template v-if="loaded">
      <!-- Identity provider -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("sso.provider.title") }}</CardTitle>
          <CardDescription>{{ $t("sso.provider.description") }}</CardDescription>
        </CardHeader>
        <CardContent>
          <form class="space-y-4" @submit.prevent="saveConnection">
            <div class="space-y-1">
              <p class="text-sm font-medium">{{ $t("sso.provider.redirectUri") }}</p>
              <p class="p-2 border rounded-md font-mono text-sm break-all">{{ redirectUri }}</p>
            </div>

            <Input
              id="sso-issuer"
              v-model="form.issuer"
              :label="$t('sso.provider.issuer')"
              :helper-text="$t('sso.provider.issuerHelper')"
              placeholder="https://login.example.com"
              required
            />
            <div class="grid gap-4 md:grid-cols-2">
              <Input
                id="sso-client-id"
                v-model="form.clientId"
                :label="$t('sso.provider.clientId')"
                autocomplete="off"
                required
              />
              <Input
                id="sso-client-secret"
                v-model="form.clientSecret"
                type="password"
                :label="$t('sso.provider.clientSecret')"
                :placeholder="connection ? $t('sso.provider.clientSecretKept') : ''"
                autocomplete="new-password"
                :required="!connection"
              />
            </div>

            <Input
              v-model="form.defaultRole"
              type="select"
              :label="$t('sso.provider.defaultRole')"
              :helper-text="$t('sso.provider.defaultRoleHelper')"
              :options="roleOptions"
            />
            <Input
              id="sso-role-claim"
              v-model="form.roleClaim"
              :label="$t('sso.provider.roleClaim')"
              :helper-text="$t('sso.provider.roleClaimHelper')"
              placeholder="groups"
            />

            <div v-if="form.roleClaim.trim()" class="space-y-2">
              <p class="text-sm font-medium">{{ $t("sso.provider.roleMapping") }}</p>
              <div
                v-for="(row, index) in form.mappings"
                :key="index"
                class="grid gap-2 md:grid-cols-[1fr_12rem_auto]"
              >
                <Input
                  v-model="row.group"
                  :placeholder="$t('sso.provider.groupPlaceholder')"
                  :aria-label="$t('sso.provider.groupPlaceholder')"
                />
                <Input v-model="row.role" type="select" :options="roleOptions" />
                <Button type="button" variant="ghost" @click="form.mappings.splice(index, 1)">
                  {{ $t("sso.provider.removeMapping") }}
                </Button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                @click="form.mappings.push({ group: '', role: form.defaultRole })"
              >
                {{ $t("sso.provider.addMapping") }}
              </Button>
            </div>

            <Input v-model="form.enabled" type="switch" :label="$t('sso.provider.enabled')" />

            <p class="text-sm text-neutral-muted">
              {{
                connection?.lastLoginAt
                  ? $t("sso.provider.lastLogin", {
                      date: new Date(connection.lastLoginAt).toLocaleString(),
                    })
                  : $t("sso.provider.neverUsed")
              }}
            </p>

            <div class="flex gap-2">
              <Button type="submit" :loading="saving">{{ $t("sso.provider.save") }}</Button>
              <Button
                v-if="connection"
                type="button"
                variant="destructive"
                :loading="saving"
                @click="deleteConnection"
              >
                {{ $t("sso.provider.delete") }}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <!-- Email domains -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("sso.domains.title") }}</CardTitle>
          <CardDescription>{{ $t("sso.domains.description") }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <p v-if="!domains.length" class="text-sm text-neutral-muted">
            {{ $t("sso.domains.empty") }}
          </p>
          <div v-for="domain in domains" :key="domain.id" class="p-3 border rounded-lg space-y-3">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="font-medium">{{ domain.domain }}</span>
                <Badge :variant="domain.verified ? 'success' : 'secondary'">
                  {{ domain.verified ? $t("sso.domains.verified") : $t("sso.domains.pending") }}
                </Badge>
              </div>
              <div class="flex gap-2">
                <Button
                  v-if="!domain.verified"
                  size="sm"
                  :loading="busyDomain === domain.id"
                  @click="verifyDomain(domain.id)"
                >
                  {{ $t("sso.domains.verify") }}
                </Button>
                <Button size="sm" variant="ghost" @click="removeDomain(domain.id)">
                  {{ $t("sso.domains.remove") }}
                </Button>
              </div>
            </div>
            <div v-if="domain.challenge" class="grid gap-2 md:grid-cols-2 text-sm">
              <div>
                <p class="text-xs text-neutral-muted">{{ $t("sso.domains.recordName") }}</p>
                <p class="font-mono break-all">{{ domain.challenge.name }}</p>
              </div>
              <div>
                <p class="text-xs text-neutral-muted">{{ $t("sso.domains.recordValue") }}</p>
                <p class="font-mono break-all">{{ domain.challenge.value }}</p>
              </div>
            </div>
          </div>

          <form class="flex items-end gap-2" @submit.prevent="addDomain">
            <Input
              id="sso-new-domain"
              v-model="newDomain"
              :placeholder="$t('sso.domains.placeholder')"
              :aria-label="$t('sso.domains.add')"
            />
            <Button type="submit" variant="outline" :disabled="!newDomain.trim()">
              {{ $t("sso.domains.add") }}
            </Button>
          </form>
        </CardContent>
      </Card>

      <!-- Enforcement -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("sso.enforcement.title") }}</CardTitle>
          <CardDescription>{{ $t("sso.enforcement.description") }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <p class="text-sm text-neutral-muted">{{ $t("sso.enforcement.breakGlass") }}</p>
          <p v-if="!enforced" class="text-sm text-neutral-muted">
            {{ $t("sso.enforcement.prerequisites") }}
          </p>
          <p class="text-sm text-neutral-muted">{{ $t("sso.enforcement.liftedNotice") }}</p>
          <Button
            :variant="enforced ? 'outline' : 'default'"
            :loading="enforcing"
            @click="setEnforcement(!enforced)"
          >
            {{ enforced ? $t("sso.enforcement.disable") : $t("sso.enforcement.enable") }}
          </Button>
        </CardContent>
      </Card>
    </template>
    <p v-else-if="forbidden" class="text-sm text-neutral-muted">{{ $t("sso.ownersOnly") }}</p>
  </Page>
</template>

<script setup lang="ts">
import type { RouterOutputs } from "@/types/trpc";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";

type Settings = RouterOutputs["sso"]["getSettings"];
type Role = Settings["assignableRoles"][number];

const { t } = useI18n();
const toast = useToast();

const loaded = ref(false);
const forbidden = ref(false);
const saving = ref(false);
const enforcing = ref(false);
const busyDomain = ref("");
const connection = ref<Settings["connection"]>(null);
const domains = ref<Settings["domains"]>([]);
const enforced = ref(false);
const roles = ref<readonly Role[]>([]);
const newDomain = ref("");

const form = reactive({
  issuer: "",
  clientId: "",
  clientSecret: "",
  defaultRole: "member" as Role,
  roleClaim: "",
  mappings: [] as Array<{ group: string; role: Role }>,
  enabled: true,
});

const redirectUri = computed(
  () => connection.value?.redirectUri ?? `${useRuntimeConfig().public.apiBaseUrl}/sso/callback`,
);
const roleOptions = computed(() =>
  roles.value.map((role) => ({ label: role.charAt(0).toUpperCase() + role.slice(1), value: role })),
);

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : t("sso.errors.generic");

const apply = (settings: Settings) => {
  connection.value = settings.connection;
  domains.value = settings.domains;
  enforced.value = settings.enforced;
  roles.value = settings.assignableRoles;
  if (settings.connection) {
    form.issuer = settings.connection.issuer;
    form.clientId = settings.connection.clientId;
    form.defaultRole = settings.connection.defaultRole;
    form.roleClaim = settings.connection.roleClaim ?? "";
    form.mappings = Object.entries(settings.connection.roleMapping).map(([group, role]) => ({
      group,
      role,
    }));
    form.enabled = settings.connection.enabled;
  }
};

const load = async () => {
  try {
    apply(await Hay.sso.getSettings.query());
    loaded.value = true;
  } catch {
    forbidden.value = true;
  }
};

const saveConnection = async () => {
  saving.value = true;
  try {
    const roleMapping: Record<string, Role> = {};
    if (form.roleClaim.trim()) {
      for (const { group, role } of form.mappings) {
        if (group.trim()) roleMapping[group.trim()] = role;
      }
    }
    await Hay.sso.saveConnection.mutate({
      issuer: form.issuer.trim(),
      clientId: form.clientId.trim(),
      clientSecret: form.clientSecret || undefined,
      defaultRole: form.defaultRole,
      roleClaim: form.roleClaim.trim() || null,
      roleMapping,
      enabled: form.enabled,
    });
    form.clientSecret = "";
    await load();
    toast.success(t("sso.provider.saved"));
  } catch (error) {
    toast.error(messageOf(error));
  } finally {
    saving.value = false;
  }
};

const deleteConnection = async () => {
  saving.value = true;
  try {
    await Hay.sso.deleteConnection.mutate();
    connection.value = null;
    Object.assign(form, {
      issuer: "",
      clientId: "",
      clientSecret: "",
      roleClaim: "",
      mappings: [],
    });
    await load();
    toast.success(t("sso.provider.deleted"));
  } catch (error) {
    toast.error(messageOf(error));
  } finally {
    saving.value = false;
  }
};

const addDomain = async () => {
  try {
    domains.value = await Hay.sso.addDomain.mutate({ domain: newDomain.value });
    newDomain.value = "";
  } catch (error) {
    toast.error(messageOf(error));
  }
};

const verifyDomain = async (id: string) => {
  busyDomain.value = id;
  try {
    domains.value = await Hay.sso.verifyDomain.mutate({ id });
    toast.success(t("sso.domains.verifiedToast"));
  } catch (error) {
    toast.error(messageOf(error));
  } finally {
    busyDomain.value = "";
  }
};

const removeDomain = async (id: string) => {
  try {
    domains.value = await Hay.sso.removeDomain.mutate({ id });
    await load();
    toast.success(t("sso.domains.removed"));
  } catch (error) {
    toast.error(messageOf(error));
  }
};

const setEnforcement = async (value: boolean) => {
  enforcing.value = true;
  try {
    await Hay.sso.setEnforcement.mutate({ enforced: value });
    enforced.value = value;
    toast.success(t(value ? "sso.enforcement.enabledToast" : "sso.enforcement.disabledToast"));
  } catch (error) {
    toast.error(messageOf(error));
  } finally {
    enforcing.value = false;
  }
};

onMounted(load);
</script>
