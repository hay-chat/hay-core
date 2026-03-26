import { t } from "@server/trpc";
import {
  getInstallUrl,
  listConnections,
  removeConnection,
  listRepos,
  installPlugin,
  syncPlugin,
  checkForUpdates,
} from "./git-connections.handler";

export const gitConnectionsRouter = t.router({
  getInstallUrl,
  list: listConnections,
  remove: removeConnection,
  listRepos,
  installPlugin,
  syncPlugin,
  checkForUpdates,
});
