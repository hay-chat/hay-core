import type { ChannelContext } from "./context.js";
import type { ConnectionMode } from "./connection.js";
import { GraphApiError, type PhoneNumberInfo, type WabaInfo } from "./graph-client.js";

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

const PHONE_FIELDS_BASIC = ["display_phone_number", "verified_name", "quality_rating", "status"];

// `primary_funding_id` is refused (Graph code 10, "requires … Business Solution
// Provider") for Tech Providers such as Hay's own app; the basic set is the
// fallback, and the payment method is then reported as unknown.
const WABA_FIELDS = ["name", "primary_funding_id", "owner_business_info"];
const WABA_FIELDS_BASIC = ["name"];

/** Graph code 10: the app may not read one of the requested fields. */
function isPermissionError(error: unknown): boolean {
  return error instanceof GraphApiError && (error.code === 10 || error.code === 200);
}

export interface ChannelStatus {
  mode: ConnectionMode;
  connected: boolean;
  /** Values the Embedded Signup popup needs (public identifiers, not secrets). */
  embeddedSignup: { appId: string | null; configId: string | null };
  phone?: PhoneNumberInfo;
  /** `hasPaymentMethod` is null when Meta does not let this app read it. */
  waba?: { id: string; name?: string; hasPaymentMethod: boolean | null; businessId?: string };
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
    const { accessToken } = connection;
    const [phone, waba] = await Promise.all([
      withFieldFallback(ctx, "phone", PHONE_FIELDS, PHONE_FIELDS_BASIC, (fields) =>
        ctx.graph.getPhone(connection.phoneNumberId, accessToken, fields),
      ),
      withFieldFallback(ctx, "waba", WABA_FIELDS, WABA_FIELDS_BASIC, (fields) =>
        ctx.graph.getWaba(connection.wabaId, accessToken, fields),
      ),
    ]);
    const businessId = connection.businessId ?? waba.value.owner_business_info?.id;
    return {
      ...base,
      connected: true,
      phone: phone.value,
      waba: {
        id: connection.wabaId,
        name: waba.value.name,
        hasPaymentMethod: waba.reduced ? null : Boolean(waba.value.primary_funding_id),
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

/**
 * Read with the full field list; if Meta refuses one of the fields for this
 * app, retry once with the basic set. `reduced` tells the caller which it got.
 */
async function withFieldFallback<T>(
  ctx: ChannelContext,
  target: "phone" | "waba",
  fields: string[],
  basicFields: string[],
  read: (fields: string[]) => Promise<T>,
): Promise<{ value: T; reduced: boolean }> {
  try {
    return { value: await read(fields), reduced: false };
  } catch (error: unknown) {
    if (!isPermissionError(error)) {
      throw error;
    }
    ctx.logger.info("WhatsApp status — Meta refused some fields, retrying with the basic set", {
      target,
      dropped: fields.filter((field) => !basicFields.includes(field)),
    });
    return { value: await read(basicFields), reduced: true };
  }
}
