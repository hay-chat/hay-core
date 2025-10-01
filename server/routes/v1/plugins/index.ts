import { t } from "@server/trpc";
import {
  getAllPlugins,
  getPlugin,
  getPluginInstances,
  enablePlugin,
  disablePlugin,
  configurePlugin,
  getPluginConfiguration,
  getPluginUITemplate,
  getMCPTools,
  getMenuItems,
} from "./plugins.handler";

export const pluginsRouter = t.router({
  getAll: getAllPlugins,
  get: getPlugin,
  getInstances: getPluginInstances,
  enable: enablePlugin,
  disable: disablePlugin,
  configure: configurePlugin,
  getConfiguration: getPluginConfiguration,
  getUITemplate: getPluginUITemplate,
  getMCPTools: getMCPTools,
  getMenuItems: getMenuItems,
});