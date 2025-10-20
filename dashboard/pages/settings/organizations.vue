<template>
  <Page
    title="Organization Settings"
    description="Manage your organization members and settings"
    width="max"
  >
    <!-- Organization Members -->
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between">
          <div>
            <CardTitle>Team Members</CardTitle>
            <CardDescription>Manage who has access to {{ userStore.activeOrganization?.name }}</CardDescription>
          </div>
          <Button v-if="userStore.isAdmin" @click="inviteDialogOpen = true">
            <UserPlus class="h-4 w-4 mr-2" />
            Invite Member
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div v-if="loading" class="flex items-center justify-center py-8">
          <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
        </div>

        <div v-else-if="members.length === 0" class="text-center py-8 text-muted-foreground">
          No members found
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="member in members"
            :key="member.id"
            class="flex items-center justify-between p-4 rounded-lg border"
          >
            <div class="flex items-center gap-3">
              <div class="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <User class="h-5 w-5" />
              </div>
              <div>
                <p class="font-medium">{{ member.firstName || member.lastName ? `${member.firstName || ''} ${member.lastName || ''}`.trim() : member.email }}</p>
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
                  <DropdownMenuItem class="text-destructive" @click="removeMember(member)">
                    <Trash2 class="h-4 w-4 mr-2" />
                    Remove Member
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
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
        <div v-if="loadingInvitations" class="flex items-center justify-center py-8">
          <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
        </div>

        <div v-else-if="invitations.length === 0" class="text-center py-8 text-muted-foreground">
          No pending invitations
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="invitation in invitations"
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
              <Badge variant="outline" class="capitalize">{{ invitation.role }}</Badge>
              <Badge :variant="invitation.status === 'pending' ? 'secondary' : 'destructive'">
                {{ invitation.status }}
              </Badge>
              <Button
                v-if="invitation.status === 'pending'"
                variant="ghost"
                size="icon"
                @click="cancelInvitation(invitation.id)"
              >
                <X class="h-4 w-4" />
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
          <DialogDescription>
            Update the role for {{ selectedMember?.email }}
          </DialogDescription>
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
  X,
  Loader2,
} from "lucide-vue-next";
import { useUserStore } from "@/stores/user";
import { Hay } from "@/utils/api";
import { useToast } from "@/components/ui/toast";

const userStore = useUserStore();
const { toast } = useToast();

const loading = ref(false);
const loadingInvitations = ref(false);
const members = ref<any[]>([]);
const invitations = ref<any[]>([]);

const inviteDialogOpen = ref(false);
const roleDialogOpen = ref(false);
const sendingInvite = ref(false);
const updatingRole = ref(false);
const selectedMember = ref<any>(null);

const inviteForm = ref({
  email: "",
  role: "member" as "owner" | "admin" | "member" | "viewer" | "contributor",
  message: "",
});

const roleForm = ref({
  role: "member" as "owner" | "admin" | "member" | "viewer" | "contributor",
});

const loadMembers = async () => {
  loading.value = true;
  try {
    const response = await Hay.organizations.listMembers.query();
    members.value = response;
  } catch (error: any) {
    toast({
      title: "Error",
      description: error.message || "Failed to load members",
      variant: "destructive",
    });
  } finally {
    loading.value = false;
  }
};

const loadInvitations = async () => {
  loadingInvitations.value = true;
  try {
    const response = await Hay.invitations.listInvitations.query();
    invitations.value = response;
  } catch (error: any) {
    toast({
      title: "Error",
      description: error.message || "Failed to load invitations",
      variant: "destructive",
    });
  } finally {
    loadingInvitations.value = false;
  }
};

const sendInvitation = async () => {
  if (!inviteForm.value.email) {
    toast({
      title: "Error",
      description: "Please enter an email address",
      variant: "destructive",
    });
    return;
  }

  sendingInvite.value = true;
  try {
    await Hay.invitations.sendInvitation.mutate({
      email: inviteForm.value.email,
      role: inviteForm.value.role,
      message: inviteForm.value.message || undefined,
    });

    toast({
      title: "Success",
      description: "Invitation sent successfully",
    });

    inviteDialogOpen.value = false;
    inviteForm.value = { email: "", role: "member", message: "" };
    await loadInvitations();
  } catch (error: any) {
    toast({
      title: "Error",
      description: error.message || "Failed to send invitation",
      variant: "destructive",
    });
  } finally {
    sendingInvite.value = false;
  }
};

const cancelInvitation = async (invitationId: string) => {
  try {
    await Hay.invitations.cancelInvitation.mutate({ invitationId });
    toast({
      title: "Success",
      description: "Invitation cancelled",
    });
    await loadInvitations();
  } catch (error: any) {
    toast({
      title: "Error",
      description: error.message || "Failed to cancel invitation",
      variant: "destructive",
    });
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

    toast({
      title: "Success",
      description: "Member role updated successfully",
    });

    roleDialogOpen.value = false;
    await loadMembers();
  } catch (error: any) {
    toast({
      title: "Error",
      description: error.message || "Failed to update role",
      variant: "destructive",
    });
  } finally {
    updatingRole.value = false;
  }
};

const removeMember = async (member: any) => {
  if (!confirm(`Are you sure you want to remove ${member.email} from the organization?`)) {
    return;
  }

  try {
    await Hay.organizations.removeMember.mutate({ userId: member.userId });
    toast({
      title: "Success",
      description: "Member removed successfully",
    });
    await loadMembers();
  } catch (error: any) {
    toast({
      title: "Error",
      description: error.message || "Failed to remove member",
      variant: "destructive",
    });
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
