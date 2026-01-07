import { t } from "@server/trpc";
import {
  getAllPlugins,
  getPlugin,
  getPluginInstances,
  enablePlugin,
  disablePlugin,
  restartPlugin,
  configurePlugin,
  getPluginUITemplate,
  getMCPTools,
  refreshMCPTools,
  getMenuItems,
  testConnection,
  initiateOAuth,
  isOAuthAvailable,
  getOAuthStatus,
  revokeOAuth,
  validateAuth,
} from "./plugins.handler";

export const pluginsRouter = t.router({
  getAll: getAllPlugins,
  get: getPlugin,
  getInstances: getPluginInstances,
  enable: enablePlugin,
  disable: disablePlugin,
  restart: restartPlugin,
  configure: configurePlugin,
  getUITemplate: getPluginUITemplate,
  getMCPTools: getMCPTools,
  refreshMCPTools: refreshMCPTools,
  getMenuItems: getMenuItems,
  testConnection: testConnection,
  validateAuth: validateAuth,
  // Note: Plugin UI assets are served via HTTP endpoint at /plugins/ui/:pluginName/:assetPath
  oauth: {
    initiate: initiateOAuth,
    isAvailable: isOAuthAvailable,
    status: getOAuthStatus,
    revoke: revokeOAuth,
  },
});
