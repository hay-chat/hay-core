/**
 * Refresh plugin metadata from running worker
 * Usage: npx tsx scripts/refresh-plugin-metadata.ts <pluginId>
 */

import { AppDataSource } from "../server/database/data-source";
import { pluginRegistryRepository } from "../server/repositories/plugin-registry.repository";

async function refreshMetadata(pluginId: string) {
  try {
    await AppDataSource.initialize();
    console.log(`Refreshing metadata for ${pluginId}...`);

    // Import the metadata service
    const { fetchMetadataFromWorker } = await import("../server/services/plugin-metadata.service");

    // Get the plugin from registry
    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    // Find the running worker port (assuming it's in the process list)
    const { execSync } = await import("child_process");
    let portMatch: string;
    try {
      portMatch = execSync(
        `ps aux | grep "hubspot" | grep -v grep | grep -o 'port=[0-9]*' | head -1`,
        { encoding: "utf-8" },
      ).trim();
    } catch (e) {
      portMatch = "";
    }

    if (!portMatch) {
      throw new Error(`No running worker found for ${pluginId}. Please enable the plugin first.`);
    }

    const port = parseInt(portMatch.replace("port=", ""));
    console.log(`Found worker on port ${port}`);

    // Fetch metadata from worker
    const metadata = await fetchMetadataFromWorker(port, pluginId);
    console.log("Fetched metadata from worker");

    // Update in database
    await pluginRegistryRepository.updateMetadata(pluginId, {
      ...metadata,
      updatedAt: new Date(),
    });

    console.log("✅ Metadata updated successfully!");
    console.log("OAuth URLs:", {
      authorizationUrl: metadata.authMethods?.find((m: any) => m.type === "oauth2")
        ?.authorizationUrl,
      tokenUrl: metadata.authMethods?.find((m: any) => m.type === "oauth2")?.tokenUrl,
    });

    await AppDataSource.destroy();
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

const pluginId = process.argv[2];
if (!pluginId) {
  console.error("Usage: npx tsx scripts/refresh-plugin-metadata.ts <pluginId>");
  process.exit(1);
}

refreshMetadata(pluginId);
