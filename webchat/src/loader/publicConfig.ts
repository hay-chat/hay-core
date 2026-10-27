import type { HayChatConfig, PublicConfig } from "@/types";

/**
 * `webchat.getPublicConfig`: whether the widget may show (disabled or
 * suspended organizations get `enabled: false`) plus the agent's name and
 * avatar. Resolves to null when the request fails, so a network blip never
 * hides the widget.
 */
export async function fetchPublicConfig(config: HayChatConfig): Promise<PublicConfig | null> {
  try {
    const input = JSON.stringify({ organizationId: config.organizationId });
    const response = await fetch(
      `${config.baseUrl}/v1/webchat.getPublicConfig?input=${encodeURIComponent(input)}`,
    );
    if (!response.ok) {
      console.warn(
        "[Hay Webchat] Public config fetch failed:",
        response.status,
        response.statusText,
      );
      return null;
    }
    const data = await response.json();
    return data?.result?.data ?? null;
  } catch (error) {
    console.warn("[Hay Webchat] Failed to fetch public config:", error);
    return null;
  }
}
