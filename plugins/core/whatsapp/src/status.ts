import type { ChannelContext } from "./context.js";
import type { ConnectionMode } from "./connection.js";
import type { PhoneNumberInfo, WabaInfo } from "./graph-client.js";

/**
 * GET /ui/status — what the settings page shows (PLAN.md Phase 2 onboarding UI).
 * Reached only through core's authenticated `plugins.callUiRoute`; the public
 * proxy refuses `/ui/*`. Never returns the token, PIN or app secret.
 */

const PHONE_FIELDS = [
  "display_phone_number",
  "verified_name",
  "name_status",
  "quality_rating",
  "status",
  "platform_type",
  "is_on_biz_app",
  "account_mode",
  "health_status",
  "whatsapp_business_manager_messaging_limit",
];

const WABA_FIELDS = ["name", "primary_funding_id", "owner_business_info"];

export interface ChannelStatus {
  mode: ConnectionMode;
  connected: boolean;
  /** Values the Embedded Signup popup needs (public identifiers, not secrets). */
  embeddedSignup: { appId: string | null; configId: string | null };
  phone?: PhoneNumberInfo;
  waba?: { id: string; name?: string; hasPaymentMethod: boolean; businessId?: string };
  /** WhatsApp Manager page where the org adds a card (Meta has no API for it). */
  paymentSettingsUrl?: string;
  error?: string;
}

export function paymentSettingsUrl(wabaId: string, businessId?: string): string {
  const url = new URL(
    `https://business.facebook.com/settings/whatsapp-business-accounts/${encodeURIComponent(wabaId)}`,
  );
  if (businessId) {
    url.searchParams.set("business_id", businessId);
  }
  url.searchParams.set("tab", "whatsapp_settings");
  return url.toString();
}

export async function getChannelStatus(
  ctx: ChannelContext,
  settings: { mode: ConnectionMode; appId: string | null; configId: string | null },
): Promise<ChannelStatus> {
  const base: ChannelStatus = {
    mode: settings.mode,
    connected: false,
    embeddedSignup: { appId: settings.appId, configId: settings.configId },
  };

  const connection = ctx.getConnection();
  if (!connection || connection.mode !== settings.mode) {
    return base;
  }

  try {
    const [phone, waba] = await Promise.all([
      ctx.graph.getPhone(connection.phoneNumberId, connection.accessToken, PHONE_FIELDS),
      ctx.graph.getWaba(connection.wabaId, connection.accessToken, WABA_FIELDS) as Promise<WabaInfo>,
    ]);
    const businessId = connection.businessId ?? waba.owner_business_info?.id;
    return {
      ...base,
      connected: true,
      phone,
      waba: {
        id: connection.wabaId,
        name: waba.name,
        hasPaymentMethod: Boolean(waba.primary_funding_id),
        businessId,
      },
      paymentSettingsUrl: paymentSettingsUrl(connection.wabaId, businessId),
    };
  } catch (error: unknown) {
    ctx.logger.warn("WhatsApp status lookup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ...base,
      connected: true,
      error: error instanceof Error ? error.message : "Status lookup failed",
    };
  }
}
