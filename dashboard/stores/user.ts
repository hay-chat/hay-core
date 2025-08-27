import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useAuthStore } from './auth';
import { useApi } from '~/composables/useApi';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  phone?: string;
  timezone?: string;
  language?: string;
  bio?: string;
  emailVerified: boolean;
  twoFactorEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  emailNotifications: boolean;
  pushNotifications: boolean;
  marketingEmails: boolean;
  weeklyDigest: boolean;
  compactView: boolean;
  sidebarCollapsed: boolean;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  description?: string;
  website?: string;
  industry?: string;
  size?: string;
  plan: 'free' | 'starter' | 'pro' | 'enterprise';
  billingEmail?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  id: string;
  userId: string;
  organizationId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  fullName: string;
  email: string;
  avatar?: string;
  joinedAt: string;
  lastActiveAt?: string;
  status: 'active' | 'inactive' | 'invited';
}

interface UserState {
  profile: UserProfile | null;
  preferences: UserPreferences;
  organization: Organization | null;
  teamMembers: TeamMember[];
  isLoading: boolean;
  error: string | null;
}

export const useUserStore = defineStore('user', () => {
  // Initialize API
  const api = useApi();

  // State
  const profile = ref<UserProfile | null>(null);
  const preferences = ref<UserPreferences>({
    theme: 'system',
    emailNotifications: true,
    pushNotifications: true,
    marketingEmails: false,
    weeklyDigest: true,
    compactView: false,
    sidebarCollapsed: false,
  });
  const organization = ref<Organization | null>(null);
  const teamMembers = ref<TeamMember[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const fullName = computed(() => profile.value?.fullName || '');

  const initials = computed(() => {
    if (!profile.value?.fullName) return '';
    return profile.value.fullName
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  });

  const avatarUrl = computed(() => profile.value?.avatar || null);

  const isEmailVerified = computed(() => profile.value?.emailVerified || false);

  const hasTwoFactor = computed(() => profile.value?.twoFactorEnabled || false);

  const organizationPlan = computed(() => organization.value?.plan || 'free');

  const isOrganizationOwner = computed(() => {
    const authStore = useAuthStore();
    const currentUserId = authStore.user?.id;
    if (!currentUserId) return false;

    const member = teamMembers.value.find((m) => m.userId === currentUserId);
    return member?.role === 'owner';
  });

  const isOrganizationAdmin = computed(() => {
    const authStore = useAuthStore();
    const currentUserId = authStore.user?.id;
    if (!currentUserId) return false;

    const member = teamMembers.value.find((m) => m.userId === currentUserId);
    return member?.role === 'owner' || member?.role === 'admin';
  });

  const activeTeamMembers = computed(() => {
    return teamMembers.value.filter((m) => m.status === 'active');
  });

  // Actions
  // Fetch user profile
  async function fetchProfile() {
    const authStore = useAuthStore();
    if (!authStore.isAuthenticated) return;

    isLoading.value = true;
    error.value = null;

    try {
      const data = await api.get<{ profile: UserProfile }>('/api/v1/user/profile');
      profile.value = data.profile;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'An error occurred';
      console.error('Failed to fetch profile:', err);
    } finally {
      isLoading.value = false;
    }
  }

  // Update user profile
  async function updateProfile(updates: Partial<UserProfile>) {
    const authStore = useAuthStore();
    if (!authStore.isAuthenticated) return;

    isLoading.value = true;
    error.value = null;

    try {
      const data = await api.patch<{ profile: UserProfile }>('/api/v1/user/profile', updates);

      profile.value = data.profile;

      // Update auth store user if needed
      if (authStore.user) {
        authStore.user = {
          ...authStore.user,
          fullName: data.profile.fullName,
          email: data.profile.email,
        };
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'An error occurred';
      throw err;
    } finally {
      isLoading.value = false;
    }
  }

  // Update user preferences
  async function updatePreferences(updates: Partial<UserPreferences>) {
    preferences.value = {
      ...preferences.value,
      ...updates,
    };

    // Apply theme change immediately
    if (updates.theme) {
      applyTheme(updates.theme);
    }

    // Persist to backend
    const authStore = useAuthStore();
    if (!authStore.isAuthenticated) return;

    try {
      await api.patch('/api/v1/user/preferences', preferences.value);
    } catch (err) {
      console.error('Failed to save preferences:', err);
    }
  }

  // Apply theme
  function applyTheme(theme: 'light' | 'dark' | 'system') {
    if (typeof window === 'undefined') return;

    const root = document.documentElement;

    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
    } else {
      root.classList.toggle('dark', theme === 'dark');
    }
  }

  // Fetch organization
  async function fetchOrganization() {
    const authStore = useAuthStore();
    if (!authStore.isAuthenticated || !authStore.organizationId) return;

    isLoading.value = true;
    error.value = null;

    try {
      const data = await api.get<{ organization: Organization }>(
        `/api/v1/organizations/${authStore.organizationId}`,
      );
      organization.value = data.organization;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'An error occurred';
      console.error('Failed to fetch organization:', err);
    } finally {
      isLoading.value = false;
    }
  }

  // Update organization
  async function updateOrganization(updates: Partial<Organization>) {
    const authStore = useAuthStore();
    if (!authStore.isAuthenticated || !authStore.organizationId) return;

    isLoading.value = true;
    error.value = null;

    try {
      const data = await api.patch<{ organization: Organization }>(
        `/api/v1/organizations/${authStore.organizationId}`,
        updates,
      );
      organization.value = data.organization;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'An error occurred';
      throw err;
    } finally {
      isLoading.value = false;
    }
  }

  // Fetch team members
  async function fetchTeamMembers() {
    const authStore = useAuthStore();
    if (!authStore.isAuthenticated || !authStore.organizationId) return;

    isLoading.value = true;
    error.value = null;

    try {
      const data = await api.get<{ members: TeamMember[] }>(
        `/api/v1/organizations/${authStore.organizationId}/members`,
      );
      teamMembers.value = data.members;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'An error occurred';
      console.error('Failed to fetch team members:', err);
    } finally {
      isLoading.value = false;
    }
  }

  // Invite team member
  async function inviteTeamMember(email: string, role: TeamMember['role']) {
    const authStore = useAuthStore();
    if (!authStore.isAuthenticated || !authStore.organizationId) return;

    try {
      await api.post(`/api/v1/organizations/${authStore.organizationId}/invite`, { email, role });

      // Refresh team members list
      await fetchTeamMembers();
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'An error occurred';
      throw err;
    }
  }

  // Remove team member
  async function removeTeamMember(memberId: string) {
    const authStore = useAuthStore();
    if (!authStore.isAuthenticated || !authStore.organizationId) return;

    try {
      await api.delete(`/api/v1/organizations/${authStore.organizationId}/members/${memberId}`);

      // Remove from local state
      teamMembers.value = teamMembers.value.filter((m) => m.id !== memberId);
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'An error occurred';
      throw err;
    }
  }

  // Upload avatar
  async function uploadAvatar(file: File) {
    const authStore = useAuthStore();
    if (!authStore.isAuthenticated) return;

    const formData = new FormData();
    formData.append('avatar', file);

    try {
      const data = await api.upload<{ avatarUrl: string }>('/api/v1/user/avatar', formData);
      if (profile.value) {
        profile.value.avatar = data.avatarUrl;
      }
    } catch (err: any) {
      error.value = err.statusMessage || err.message || 'An error occurred';
      throw err;
    }
  }

  // Clear user data
  function clearUserData() {
    profile.value = null;
    organization.value = null;
    teamMembers.value = [];
    error.value = null;
  }

  // Initialize user data
  async function initializeUserData() {
    const authStore = useAuthStore();
    if (!authStore.isAuthenticated) return;

    // Load all user-related data in parallel
    await Promise.all([fetchProfile(), fetchOrganization(), fetchTeamMembers()]);

    // Apply saved theme preference
    applyTheme(preferences.value.theme);
  }

  return {
    // State
    profile,
    preferences,
    organization,
    teamMembers,
    isLoading,
    error,

    // Getters
    fullName,
    initials,
    avatarUrl,
    isEmailVerified,
    hasTwoFactor,
    organizationPlan,
    isOrganizationOwner,
    isOrganizationAdmin,
    activeTeamMembers,

    // Actions
    fetchProfile,
    updateProfile,
    updatePreferences,
    applyTheme,
    fetchOrganization,
    updateOrganization,
    fetchTeamMembers,
    inviteTeamMember,
    removeTeamMember,
    uploadAvatar,
    clearUserData,
    initializeUserData,
  };
});
