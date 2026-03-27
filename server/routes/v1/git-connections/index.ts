import { t } from "@server/trpc";
import {
  getInstallUrl,
  completeInstallation,
  listConnections,
  removeConnection,
  listRepos,
  installPlugin,
  syncPlugin,
  checkForUpdates,
} from "./git-connections.handler";

export const gitConnectionsRouter = t.router({
  getInstallUrl,
  completeInstallation,
  list: listConnections,
  remove: removeConnection,
  listRepos,
  installPlugin,
  syncPlugin,
  checkForUpdates,
});
