<template>
  <Page :title="$t('users.title')" :description="$t('users.description')" width="max">
    <!-- Organization Members -->
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between">
          <div>
            <CardTitle>{{ $t("users.teamMembers") }}</CardTitle>
            <CardDescription>{{
              $t("users.manageAccess", { name: userStore.activeOrganization?.name })
            }}</CardDescription>
          </div>
          <Button v-if="userStore.isAdmin" @click="inviteDialogOpen = true">
            <UserPlus class="h-4 w-4 mr-2" />
            {{ $t("users.inviteMember") }}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <!-- Search and Filter Bar -->
        <div class="flex gap-3 mb-4">
          <Input
            v-model="searchQuery"
            type="text"
            :icon-start="Search"
            :placeholder="$t('users.searchPlaceholder')"
            class="flex-1"
            @input="debouncedSearch"
          />

          <Input
            v-model="roleFilter"
            type="select"
            class="w-[180px]"
            :placeholder="$t('users.allRoles')"
            :options="[
              { label: $t('users.allRoles'), value: '' },
              { label: $t('users.roles.owner'), value: 'owner' },
              { label: $t('users.roles.admin'), value: 'admin' },
              { label: $t('users.roles.contributor'), value: 'contributor' },
              { label: $t('users.roles.member'), value: 'member' },
              { label: $t('users.roles.viewer'), value: 'viewer' },
            ]"
            @update:model-value="loadMembers(true)"
          />
        </div>

        <div v-if="loading" class="py-8">
          <Loading />
        </div>

        <div v-else-if="members.length === 0" class="text-center py-8 text-muted-foreground">
          {{ searchQuery || roleFilter ? $t("users.noMembersFiltered") : $t("users.noMembers") }}
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="member in members"
            :key="member.id"
            class="flex items-center justify-between p-4 rounded-lg border"
          >
            <div class="flex items-center gap-3">
              <Avatar
                :name="
                  member.firstName || member.lastName
                    ? `${member.firstName || ''} ${member.lastName || ''}`.trim()
                    : member.email
                "
                :url="member.avatarUrl"
                size="md"
              />
              <div>
                <p class="font-medium">
                  {{
                    member.firstName || member.lastName
                      ? `${member.firstName || ""} ${member.lastName || ""}`.trim()
                      : member.email
                  }}
                </p>
                <p class="text-sm text-muted-foreground">{{ member.email }}</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <Badge variant="secondary" class="capitalize">{{ member.role }}</Badge>
              <DropdownMenu v-if="userStore.isOwner && member.userId !== userStore.user?.id">
                <DropdownMenuTrigger as-child>
                  <Button variant="ghost" size="icon">
                    <MoreVertical class="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem @click="openRoleDialog(member)">
                    <Shield class="h-4 w-4 mr-2" />
                    {{ $t("users.changeRole") }}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    class="text-destructive"
                    @click="openRemoveMemberDialog(member)"
                  >
                    <Trash2 class="h-4 w-4 mr-2" />
                    {{ $t("users.removeMember") }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        <!-- Pagination Controls -->
        <div
          v-if="!loading && totalPages > 1"
          class="flex items-center justify-between mt-4 pt-4 border-t"
        >
          <div class="text-sm text-muted-foreground">
            {{
              $t("users.showingPagination", {
                from: (currentPage - 1) * pageSize + 1,
                to: Math.min(currentPage * pageSize, totalItems),
                total: totalItems,
              })
            }}
          </div>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" :disabled="currentPage === 1" @click="prevPage">
              <ChevronLeft class="h-4 w-4 mr-1" />
              {{ $t("users.previous") }}
            </Button>

            <div class="flex items-center gap-1">
              <Button
                v-for="page in getPaginationPages()"
                :key="page"
                :variant="page === currentPage ? 'default' : 'outline'"
                size="sm"
                class="min-w-[40px]"
                @click="goToPage(page)"
              >
                {{ page }}
              </Button>
            </div>

            <Button
              variant="outline"
              size="sm"
              :disabled="currentPage === totalPages"
              @click="nextPage"
            >
              {{ $t("users.next") }}
              <ChevronRight class="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Pending Invitations -->
    <Card v-if="userStore.isAdmin">
      <CardHeader>
        <CardTitle>{{ $t("users.pendingInvitations") }}</CardTitle>
        <CardDescription>{{ $t("users.pendingInvitationsDescription") }}</CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="loadingInvitations" class="py-8">
          <Loading />
        </div>

        <div
          v-else-if="invitations.filter((inv) => inv.status === 'pending').length === 0"
          class="text-center py-8 text-muted-foreground"
        >
          {{ $t("users.noPendingInvitations") }}
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="invitation in invitations.filter((inv) => inv.status === 'pending')"
            :key="invitation.id"
            class="flex items-center justify-between p-4 rounded-lg border"
          >
            <div>
              <p class="font-medium">{{ invitation.email }}</p>
              <p class="text-sm text-muted-foreground">
                {{ $t("users.invited", { date: formatDate(invitation.createdAt) }) }}
                <span v-if="invitation.invitedBy">{{
                  $t("users.invitedBy", { name: invitation.invitedBy.name })
                }}</span>
              </p>
            </div>
            <div class="flex items-center gap-2">
              <Button
                v-if="invitation.status === 'pending'"
                variant="outline"
                size="xs"
                :disabled="resendingInvitation === invitation.id"
                :title="$t('users.resendInvitation')"
                @click="resendInvitation(invitation.id)"
              >
                {{ $t("users.resendInvitation") }}
              </Button>
              <Button
                v-if="invitation.status === 'pending'"
                variant="outline"
                size="xs"
                :title="$t('users.cancelInvitation')"
                @click="cancelInvitation(invitation.id)"
              >
                {{ $t("users.cancelInvitation") }}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Invite Member Dialog -->
    <Dialog v-model:open="inviteDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ $t("users.inviteDialogTitle") }}</DialogTitle>
          <DialogDescription>
            {{ $t("users.inviteDialogDescription", { name: userStore.activeOrganization?.name }) }}
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <Input
            v-model="inviteForm.email"
            type="email"
            :label="$t('users.emailAddress')"
            :placeholder="$t('users.emailPlaceholder')"
          />
          <div>
            <label class="text-sm font-medium mb-2 block">{{ $t("users.role") }}</label>
            <Select v-model="inviteForm.role">
              <SelectTrigger>
                <SelectValue :placeholder="$t('users.selectRole')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">{{ $t("users.roles.owner") }}</SelectItem>
                <SelectItem value="admin">{{ $t("users.roles.admin") }}</SelectItem>
                <SelectItem value="contributor">{{ $t("users.roles.contributor") }}</SelectItem>
                <SelectItem value="member">{{ $t("users.roles.member") }}</SelectItem>
                <SelectItem value="viewer">{{ $t("users.roles.viewer") }}</SelectItem>
                <SelectItem value="agent">{{ $t("users.roles.agent") }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Input
            v-model="inviteForm.message"
            type="textarea"
            :label="$t('users.messageOptional')"
            :placeholder="$t('users.messagePlaceholder')"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" @click="inviteDialogOpen = false">{{
            $t("users.cancel")
          }}</Button>
          <Button :loading="sendingInvite" @click="sendInvitation">{{
            $t("users.sendInvitation")
          }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Change Role Dialog -->
    <Dialog v-model:open="roleDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ $t("users.changeRoleDialogTitle") }}</DialogTitle>
          <DialogDescription>{{
            $t("users.changeRoleDialogDescription", { email: selectedMember?.email })
          }}</DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div>
            <label class="text-sm font-medium mb-2 block">{{ $t("users.role") }}</label>
            <Select v-model="roleForm.role">
              <SelectTrigger>
                <SelectValue :placeholder="$t('users.selectRole')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">{{ $t("users.roles.owner") }}</SelectItem>
                <SelectItem value="admin">{{ $t("users.roles.admin") }}</SelectItem>
                <SelectItem value="contributor">{{ $t("users.roles.contributor") }}</SelectItem>
                <SelectItem value="member">{{ $t("users.roles.member") }}</SelectItem>
                <SelectItem value="viewer">{{ $t("users.roles.viewer") }}</SelectItem>
                <SelectItem value="agent">{{ $t("users.roles.agent") }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="roleDialogOpen = false">{{
            $t("users.cancel")
          }}</Button>
          <Button :loading="updatingRole" @click="updateMemberRole">{{
            $t("users.updateRole")
          }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Remove Member Confirmation Dialog -->
    <ConfirmDialog
      v-model:open="removeMemberDialogOpen"
      :title="$t('users.removeDialogTitle')"
      :description="$t('users.removeDialogDescription', { email: memberToRemove?.email })"
      :confirm-text="$t('users.removeConfirmText')"
      :destructive="true"
      @confirm="confirmRemoveMember"
    />
  </Page>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import {
  UserPlus,
  MoreVertical,
  Shield,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-vue-next";
import { useUserStore } from "@/stores/user";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import Avatar from "@/components/ui/Avatar.vue";
import type { RouterOutputs, RouterInputs } from "@/types/trpc";

type OrganizationMember = RouterOutputs["organizations"]["listMembers"]["items"][number];
type Invitation = RouterOutputs["invitations"]["listInvitations"][number];

// Roles selectable in the invite / change-role forms. Mirrors the
// updateMemberRole / sendInvitation mutation inputs, which do not accept "agent".
type AssignableRole = RouterInputs["organizations"]["updateMemberRole"]["role"];
const ASSIGNABLE_ROLES: readonly AssignableRole[] = [
  "owner",
  "admin",
  "contributor",
  "member",
  "viewer",
];
const isAssignableRole = (role: OrganizationMember["role"]): role is AssignableRole =>
  (ASSIGNABLE_ROLES as readonly string[]).includes(role);

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const { t } = useI18n();
const userStore = useUserStore();
const toastService = useToast();
const { formatDate } = useOrgDateTime();

const loading = ref(false);
const loadingInvitations = ref(false);
const members = ref<OrganizationMember[]>([]);
const invitations = ref<Invitation[]>([]);

// Pagination and filtering
const currentPage = ref(1);
const pageSize = ref(10);
const totalItems = ref(0);
const totalPages = ref(0);
const searchQuery = ref("");
const roleFilter = ref<"" | "owner" | "admin" | "contributor" | "member" | "viewer">("");
let searchTimeout: NodeJS.Timeout | null = null;

const inviteDialogOpen = ref(false);
const roleDialogOpen = ref(false);
const sendingInvite = ref(false);
const updatingRole = ref(false);
const selectedMember = ref<OrganizationMember | null>(null);
const removeMemberDialogOpen = ref(false);
const memberToRemove = ref<OrganizationMember | null>(null);

const inviteForm = ref<{ email: string; role: AssignableRole; message: string }>({
  email: "",
  role: "member",
  message: "",
});

const roleForm = ref<{ role: AssignableRole }>({
  role: "member",
});

const resendingInvitation = ref<string | null>(null);

const loadMembers = async (resetPage = false) => {
  if (resetPage) {
    currentPage.value = 1;
  }

  loading.value = true;
  try {
    const response = await Hay.organizations.listMembers.query({
      pagination: {
        page: currentPage.value,
        limit: pageSize.value,
      },
      search: searchQuery.value || undefined,
      role: roleFilter.value || undefined,
    });

    members.value = response.items;
    totalItems.value = response.pagination.total;
    totalPages.value = response.pagination.totalPages;
  } catch (error: unknown) {
    toastService.error(
      t("users.loadMembersFailed"),
      getErrorMessage(error, t("users.loadMembersFailedDescription")),
    );
  } finally {
    loading.value = false;
  }
};

const debouncedSearch = () => {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }
  searchTimeout = setTimeout(() => {
    loadMembers(true);
  }, 300);
};

const goToPage = (page: number) => {
  if (page >= 1 && page <= totalPages.value) {
    currentPage.value = page;
    loadMembers();
  }
};

const nextPage = () => {
  if (currentPage.value < totalPages.value) {
    currentPage.value++;
    loadMembers();
  }
};

const prevPage = () => {
  if (currentPage.value > 1) {
    currentPage.value--;
    loadMembers();
  }
};

const getPaginationPages = () => {
  const pages: number[] = [];
  const maxPagesToShow = 5;

  if (totalPages.value <= maxPagesToShow) {
    // Show all pages if total is less than max
    for (let i = 1; i <= totalPages.value; i++) {
      pages.push(i);
    }
  } else {
    // Always show first page
    pages.push(1);

    // Calculate range around current page
    let start = Math.max(2, currentPage.value - 1);
    let end = Math.min(totalPages.value - 1, currentPage.value + 1);

    // Adjust range if we're near the beginning or end
    if (currentPage.value <= 3) {
      end = 4;
    } else if (currentPage.value >= totalPages.value - 2) {
      start = totalPages.value - 3;
    }

    // Add pages in range
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    // Always show last page
    if (!pages.includes(totalPages.value)) {
      pages.push(totalPages.value);
    }
  }

  return pages;
};

const loadInvitations = async () => {
  loadingInvitations.value = true;
  try {
    const response = await Hay.invitations.listInvitations.query();
    invitations.value = response;
  } catch (error: unknown) {
    toastService.error(
      t("users.loadInvitationsFailed"),
      getErrorMessage(error, t("users.loadInvitationsFailedDescription")),
    );
  } finally {
    loadingInvitations.value = false;
  }
};

const sendInvitation = async () => {
  if (!inviteForm.value.email) {
    toastService.error(t("users.emailRequired"), t("users.emailRequiredDescription"));
    return;
  }

  sendingInvite.value = true;
  try {
    await Hay.invitations.sendInvitation.mutate({
      email: inviteForm.value.email,
      role: inviteForm.value.role,
      message: inviteForm.value.message || undefined,
    });

    toastService.success(
      t("users.invitationSent"),
      t("users.invitationSentDescription", { email: inviteForm.value.email }),
    );

    inviteDialogOpen.value = false;
    inviteForm.value = { email: "", role: "member", message: "" };
    await loadInvitations();
  } catch (error: unknown) {
    toastService.error(
      t("users.sendInvitationFailed"),
      getErrorMessage(error, t("users.sendInvitationFailedDescription")),
    );
  } finally {
    sendingInvite.value = false;
  }
};

const cancelInvitation = async (invitationId: string) => {
  try {
    await Hay.invitations.cancelInvitation.mutate({ invitationId });
    toastService.success(t("users.invitationCancelled"), t("users.invitationCancelledDescription"));
    await loadInvitations();
  } catch (error: unknown) {
    toastService.error(
      t("users.cancelInvitationFailed"),
      getErrorMessage(error, t("users.cancelInvitationFailedDescription")),
    );
  }
};

const resendInvitation = async (invitationId: string) => {
  resendingInvitation.value = invitationId;
  try {
    await Hay.invitations.resendInvitation.mutate({ invitationId });
    toastService.success(t("users.invitationResent"), t("users.invitationResentDescription"));
    await loadInvitations();
  } catch (error: unknown) {
    toastService.error(
      t("users.resendInvitationFailed"),
      getErrorMessage(error, t("users.resendInvitationFailedDescription")),
    );
  } finally {
    resendingInvitation.value = null;
  }
};

const openRoleDialog = (member: OrganizationMember) => {
  selectedMember.value = member;
  // "agent" members cannot be reassigned via this dialog (mutation rejects it);
  // default the selector to "member" so the form stays valid.
  roleForm.value.role = isAssignableRole(member.role) ? member.role : "member";
  roleDialogOpen.value = true;
};

const updateMemberRole = async () => {
  if (!selectedMember.value) return;

  updatingRole.value = true;
  try {
    await Hay.organizations.updateMemberRole.mutate({
      userId: selectedMember.value.userId,
      role: roleForm.value.role,
    });

    toastService.success(
      t("users.roleUpdated"),
      t("users.roleUpdatedDescription", {
        email: selectedMember.value.email,
        role: roleForm.value.role,
      }),
    );

    roleDialogOpen.value = false;
    await loadMembers();
  } catch (error: unknown) {
    toastService.error(
      t("users.updateRoleFailed"),
      getErrorMessage(error, t("users.updateRoleFailedDescription")),
    );
  } finally {
    updatingRole.value = false;
  }
};

const openRemoveMemberDialog = (member: OrganizationMember) => {
  memberToRemove.value = member;
  removeMemberDialogOpen.value = true;
};

const confirmRemoveMember = async () => {
  if (!memberToRemove.value) return;

  try {
    await Hay.organizations.removeMember.mutate({ userId: memberToRemove.value.userId });
    toastService.success(
      t("users.memberRemoved"),
      t("users.memberRemovedDescription", { email: memberToRemove.value.email }),
    );
    await loadMembers();
  } catch (error: unknown) {
    toastService.error(
      t("users.removeMemberFailed"),
      getErrorMessage(error, t("users.removeMemberFailedDescription")),
    );
  } finally {
    memberToRemove.value = null;
  }
};

// formatDate is provided by useOrgDateTime()

onMounted(() => {
  loadMembers();
  if (userStore.isAdmin) {
    loadInvitations();
  }
});
</script>
