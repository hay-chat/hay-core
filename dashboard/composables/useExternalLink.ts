import { Hay } from "@/utils/api";

/**
 * External links (custom menu items, billing portal, suspension redirect) carry
 * a one-time auth code so the destination can establish its own session.
 */
export function useExternalLink() {
  const buildUrl = async (url: string, extraQuery: Record<string, string> = {}) => {
    const target = new URL(url);
    try {
      const result = await Hay.auth.generateAuthCode.mutate();
      target.searchParams.set("code", result.code);
    } catch (error) {
      // Without a code the destination will ask the user to re-authenticate.
      console.error("Failed to generate auth code:", error);
    }
    for (const [key, value] of Object.entries(extraQuery)) {
      target.searchParams.set(key, value);
    }
    return target.toString();
  };

  /** Open the link in a new tab. */
  const open = async (url: string) => {
    window.open(await buildUrl(url), "_blank");
  };

  /** Leave the dashboard for the link in the current tab. */
  const redirect = async (url: string, extraQuery: Record<string, string> = {}) => {
    window.location.href = await buildUrl(url, extraQuery);
  };

  return { open, redirect };
}
