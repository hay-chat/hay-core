import { h, type Component } from "vue";
import { Globe } from "lucide-vue-next";
import { useAppStore } from "@/stores/app";
import { useDomain } from "@/composables/useDomain";

// Channel display helpers. Core stays plugin-agnostic: there is NO hardcoded
// list of channel identifiers here. A conversation's `channel` string is
// resolved against the enabled channel plugins, and the plugin supplies its own
// name + thumbnail. Built-in channels with no plugin (e.g. "web") fall back to a
// generic icon and a capitalized label.

const findChannelPlugin = (channel?: string | null) => {
  const appStore = useAppStore();
  const resolved = channel || "web";
  return appStore.enabledPlugins.find((p) => p.type?.includes("channel") && p.channel === resolved);
};

// Returns a renderable icon for `<component :is>`: the plugin's thumbnail when a
// plugin handles the channel, otherwise a generic icon for built-in channels.
export const getChannelIcon = (channel?: string | null): Component => {
  const plugin = findChannelPlugin(channel);
  if (!plugin) return Globe;

  const { getApiUrl } = useDomain();
  const src = getApiUrl(`/plugins/thumbnails/${encodeURIComponent(plugin.id)}`);
  return () => h("img", { src, alt: plugin.name, class: "rounded object-cover" });
};

// Human-readable channel label: the plugin's display name, or a capitalized
// fallback for built-in channels (e.g. "web" -> "Web").
export const getChannelLabel = (channel?: string | null): string => {
  const plugin = findChannelPlugin(channel);
  if (plugin) return plugin.name;
  const resolved = channel || "web";
  return resolved.charAt(0).toUpperCase() + resolved.slice(1);
};

// Channel-type plugins enabled for the org that declare a channel identifier.
// Used to decide whether the org has more than one channel in play.
export const getEnabledChannelPlugins = () => {
  const appStore = useAppStore();
  return appStore.enabledPlugins.filter((p) => p.type?.includes("channel") && p.channel);
};
