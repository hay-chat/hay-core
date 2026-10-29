export interface SettingsTab {
  labelKey: string;
  path: string;
  adminOnly?: boolean;
}

export interface SettingsSection {
  id: string;
  labelKey: string;
  tabs: SettingsTab[];
}

// One source of truth for the settings sidebar entries and the tab bar on each page.
// Each tab keeps its own route; a section is the group of routes that share a tab bar.
export const SETTINGS_NAV: SettingsSection[] = [
  {
    id: "assistant",
    labelKey: "nav.assistant",
    tabs: [
      // TODO: Identity becomes the organization's own page when agents are removed.
      { labelKey: "nav.identity", path: "/agents", adminOnly: true },
      { labelKey: "nav.actionsSettings", path: "/settings/actions", adminOnly: true },
      { labelKey: "nav.llmProviders", path: "/settings/llm", adminOnly: true },
    ],
  },
  {
    id: "channels",
    labelKey: "nav.channels",
    tabs: [
      { labelKey: "nav.channelList", path: "/channels", adminOnly: true },
      { labelKey: "nav.webchat", path: "/settings/webchat", adminOnly: true },
      { labelKey: "nav.businessHours", path: "/settings/business-hours", adminOnly: true },
    ],
  },
  {
    id: "workspace",
    labelKey: "nav.workspace",
    tabs: [
      { labelKey: "nav.general", path: "/settings/general", adminOnly: true },
      { labelKey: "nav.users", path: "/settings/users", adminOnly: true },
    ],
  },
  {
    id: "privacy",
    labelKey: "nav.privacy",
    tabs: [
      { labelKey: "nav.workspaceData", path: "/settings/privacy", adminOnly: true },
      { labelKey: "nav.customerPrivacy", path: "/settings/customer-privacy" },
    ],
  },
  {
    id: "developers",
    labelKey: "nav.developers",
    tabs: [
      { labelKey: "nav.apiTokens", path: "/settings/api-tokens", adminOnly: true },
      { labelKey: "nav.gitConnections", path: "/settings/git-connections", adminOnly: true },
    ],
  },
  {
    id: "billing",
    labelKey: "nav.billingUsage",
    tabs: [{ labelKey: "nav.usage", path: "/settings/usage", adminOnly: true }],
  },
  {
    id: "profile",
    labelKey: "nav.myProfile",
    tabs: [{ labelKey: "nav.myProfile", path: "/settings/profile" }],
  },
];

export const isSettingsTabActive = (tab: SettingsTab, currentPath: string): boolean =>
  currentPath === tab.path || currentPath.startsWith(`${tab.path}/`);

export const visibleSettingsTabs = (section: SettingsSection, isAdmin: boolean): SettingsTab[] =>
  section.tabs.filter((tab) => isAdmin || !tab.adminOnly);
