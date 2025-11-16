<template>
  <Page
    title="Team Members"
    description="Manage who has access to your organization"
    width="max"
  >
    <!-- Organization Members -->
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between">
          <div>
            <CardTitle>Team Members</CardTitle>
            <CardDescription
              >Manage who has access to
              {{ userStore.activeOrganization?.name }}</CardDescription
            >
          </div>
          <Button v-if="userStore.isAdmin" @click="inviteDialogOpen = true">
            <UserPlus class="h-4 w-4 mr-2" />
            Invite Member
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
                placeholder="Search members by name or email..."
                class="flex-1"
                @input="debouncedSearch"
              />

              <Input
                v-model="roleFilter"
                type="select"
                class="w-[180px]"
                placeholder="All Roles"
                :options="[
                  { label: 'All Roles', value: '' },
                  { label: 'Owner', value: 'owner' },
                  { label: 'Admin', value: 'admin' },
                  { label: 'Contributor', value: 'contributor' },
                  { label: 'Member', value: 'member' },
                  { label: 'Viewer', value: 'viewer' },
                ]"
                @update:model-value="loadMembers(true)"
              />
            </div>

            <div v-if="loading" class="py-8">
              <Loading />
            </div>

            <div v-else-if="members.length === 0" class="text-center py-8 text-muted-foreground">
              {{
                searchQuery || roleFilter
                  ? "No members found matching your filters"
                  : "No members found"
              }}
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
                        Change Role
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        class="text-destructive"
                        @click="openRemoveMemberDialog(member)"
                      >
                        <Trash2 class="h-4 w-4 mr-2" />
                        Remove Member
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
                Showing {{ (currentPage - 1) * pageSize + 1 }} to
                {{ Math.min(currentPage * pageSize, totalItems) }} of {{ totalItems }} members
              </div>
              <div class="flex items-center gap-2">
                <Button variant="outline" size="sm" :disabled="currentPage === 1" @click="prevPage">
                  <ChevronLeft class="h-4 w-4 mr-1" />
                  Previous
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
                  Next
                  <ChevronRight class="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
      </CardContent>
    </Card>

    <!-- Pending Invitations -->
    <Card v-if="userStore.isAdmin">
      <CardHeader>
        <CardTitle>Pending Invitations</CardTitle>
        <CardDescription>Invitations sent to join your organization</CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="loadingInvitations" class="py-8">
          <Loading />
        </div>

        <div
          v-else-if="invitations.filter((inv) => inv.status === 'pending').length === 0"
          class="text-center py-8 text-muted-foreground"
        >
          No pending invitations
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
                Invited {{ formatDate(invitation.createdAt) }}
                <span v-if="invitation.invitedBy">by {{ invitation.invitedBy.name }}</span>
              </p>
            </div>
            <div class="flex items-center gap-2">
              <Button
                v-if="invitation.status === 'pending'"
                variant="outline"
                size="xs"
                :disabled="resendingInvitation === invitation.id"
                title="Resend invitation"
                @click="resendInvitation(invitation.id)"
              >
                Resend invitation
              </Button>
              <Button
                v-if="invitation.status === 'pending'"
                variant="outline"
                size="xs"
                title="Cancel invitation"
                @click="cancelInvitation(invitation.id)"
              >
                Cancel invitation
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
          <DialogTitle>Invite Team Member</DialogTitle>
          <DialogDescription>
            Send an invitation to join {{ userStore.activeOrganization?.name }}
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <Input
            v-model="inviteForm.email"
            type="email"
            label="Email Address"
            placeholder="colleague@example.com"
          />
          <div>
            <label class="text-sm font-medium mb-2 block">Role</label>
            <Select v-model="inviteForm.role">
              <SelectTrigger>
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">Owner</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
                <SelectItem value="contributor">Contributor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Input
            v-model="inviteForm.message"
            type="textarea"
            label="Message (Optional)"
            placeholder="Add a personal message to the invitation"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" @click="inviteDialogOpen = false">Cancel</Button>
          <Button :loading="sendingInvite" @click="sendInvitation">Send Invitation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Change Role Dialog -->
    <Dialog v-model:open="roleDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change Member Role</DialogTitle>
          <DialogDescription> Update the role for {{ selectedMember?.email }} </DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div>
            <label class="text-sm font-medium mb-2 block">Role</label>
            <Select v-model="roleForm.role">
              <SelectTrigger>
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">Owner</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
                <SelectItem value="contributor">Contributor</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="roleDialogOpen = false">Cancel</Button>
          <Button :loading="updatingRole" @click="updateMemberRole">Update Role</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Remove Member Confirmation Dialog -->
    <ConfirmDialog
      v-model:open="removeMemberDialogOpen"
      title="Remove Member"
      :description="`Are you sure you want to remove ${memberToRemove?.email} from the organization? This action cannot be undone.`"
      confirm-text="Remove"
      :destructive="true"
      @confirm="confirmRemoveMember"
    />
  </Page>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import {
  UserPlus,
  User,
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

const userStore = useUserStore();
const toastService = useToast();

const loading = ref(false);
const loadingInvitations = ref(false);
const members = ref<any[]>([]);
const invitations = ref<any[]>([]);

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
const selectedMember = ref<any>(null);
const removeMemberDialogOpen = ref(false);
const memberToRemove = ref<any>(null);

const inviteForm = ref({
  email: "",
  role: "member" as "owner" | "admin" | "member" | "viewer" | "contributor",
  message: "",
});

const roleForm = ref({
  role: "member" as "owner" | "admin" | "member" | "viewer" | "contributor",
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
  } catch (error: any) {
    toastService.error(
      "Failed to load members",
      error.message || "Could not retrieve team members",
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
  } catch (error: any) {
    toastService.error(
      "Failed to load invitations",
      error.message || "Could not retrieve pending invitations",
    );
  } finally {
    loadingInvitations.value = false;
  }
};

const sendInvitation = async () => {
  if (!inviteForm.value.email) {
    toastService.error("Email required", "Please enter an email address");
    return;
  }

  sendingInvite.value = true;
  try {
    await Hay.invitations.sendInvitation.mutate({
      email: inviteForm.value.email,
      role: inviteForm.value.role,
      message: inviteForm.value.message || undefined,
    });

    toastService.success("Invitation sent", `Invitation sent to ${inviteForm.value.email}`);

    inviteDialogOpen.value = false;
    inviteForm.value = { email: "", role: "member", message: "" };
    await loadInvitations();
  } catch (error: any) {
    toastService.error("Failed to send invitation", error.message || "Could not send invitation");
  } finally {
    sendingInvite.value = false;
  }
};

const cancelInvitation = async (invitationId: string) => {
  try {
    await Hay.invitations.cancelInvitation.mutate({ invitationId });
    toastService.success("Invitation cancelled", "The invitation has been cancelled");
    await loadInvitations();
  } catch (error: any) {
    toastService.error(
      "Failed to cancel invitation",
      error.message || "Could not cancel invitation",
    );
  }
};

const resendInvitation = async (invitationId: string) => {
  resendingInvitation.value = invitationId;
  try {
    await Hay.invitations.resendInvitation.mutate({ invitationId });
    toastService.success("Invitation resent", "The invitation email has been sent again");
    await loadInvitations();
  } catch (error: any) {
    toastService.error(
      "Failed to resend invitation",
      error.message || "Could not resend invitation",
    );
  } finally {
    resendingInvitation.value = null;
  }
};

const openRoleDialog = (member: any) => {
  selectedMember.value = member;
  roleForm.value.role = member.role;
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
      "Role updated",
      `${selectedMember.value.email}'s role has been updated to ${roleForm.value.role}`,
    );

    roleDialogOpen.value = false;
    await loadMembers();
  } catch (error: any) {
    toastService.error("Failed to update role", error.message || "Could not update member role");
  } finally {
    updatingRole.value = false;
  }
};

const openRemoveMemberDialog = (member: any) => {
  memberToRemove.value = member;
  removeMemberDialogOpen.value = true;
};

const confirmRemoveMember = async () => {
  if (!memberToRemove.value) return;

  try {
    await Hay.organizations.removeMember.mutate({ userId: memberToRemove.value.userId });
    toastService.success(
      "Member removed",
      `${memberToRemove.value.email} has been removed from the organization`,
    );
    await loadMembers();
  } catch (error: any) {
    toastService.error("Failed to remove member", error.message || "Could not remove member");
  } finally {
    memberToRemove.value = null;
  }
};

const formatDate = (date: string | Date) => {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

onMounted(() => {
  loadMembers();
  if (userStore.isAdmin) {
    loadInvitations();
  }
});
</script>
