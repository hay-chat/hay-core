/**
 * Hay Plugin SDK - Webchat Extension Types
 *
 * Plugins extend the Hay.chat webchat widget in two declarative ways:
 *
 * 1. **Contributions** — data-only descriptors of a fixed, versioned type
 *    (e.g. `challenge@1`). Hay Core resolves config references, validates the
 *    props against the core-owned schema for that type, and sends the result
 *    to widgets that advertise support for it. The widget renders each type
 *    with its own built-in code; it never loads or evaluates plugin code.
 *
 * 2. **Gates** — synchronous server-side checks Hay Core runs before a widget
 *    action (`conversation.create`, `message.send`). Core wakes the org's worker,
 *    calls the handler with a timeout and applies the declared failure policy
 *    when the worker is slow or unavailable.
 *
 * @module @hay/plugin-sdk/types/webchat
 */

import type { HayOrg } from "./org";
import type { HayConfigRuntimeAPI, ConfigFieldReference } from "./config";
import type { HayLogger } from "./logger";

/**
 * Contribution types the widget knows how to render. Versioned: a breaking
 * change to a type's props ships as a new version (`challenge@2`) and the
 * widget advertises the versions it supports.
 */
export type WebchatContributionType = "challenge@1" | "cart@1";

/**
 * Props of a `cart@1` contribution: how to put a product in the cart of the
 * store the widget is on. The widget sends these requests from the shopper's
 * browser, to the page's own origin only, when the shopper clicks the button
 * on a product card. A product gets the button when its variant carries a
 * `cartItemId` (see `CanonicalVariant`) and the page is on the product's site.
 *
 * @example
 * ```typescript
 * register.webchat.contribution({
 *   id: 'cart',
 *   type: 'cart@1',
 *   props: {
 *     enabled: config.field('cartActions'),
 *     addPath: '/cart/add.js',
 *     addBody: '{"items":[{"id":{{cartItemId}},"quantity":{{quantity}}}]}',
 *     checkoutPath: '/checkout',
 *   },
 * });
 * ```
 */
export interface WebchatCartV1Props {
  /** The org's switch (usually a boolean config field defaulting to true). Default true. */
  enabled?: boolean;
  /** Path the widget POSTs to, on the page's origin. One leading slash. */
  addPath: string;
  /**
   * The JSON request body as text, with `{{cartItemId}}`, `{{quantity}}` and
   * `{{conversationId}}` filled in by the widget. Quote a placeholder where the
   * store expects a string. Must be valid JSON once filled.
   */
  addBody: string;
  /** Path of the store's checkout, where the card's "Checkout" link goes. */
  checkoutPath: string;
  /**
   * For stores that require a token on cart writes: the widget GETs
   * `tokenPath`, reads `tokenResponseHeader` from the answer and sends it as
   * `tokenRequestHeader` with the add request. Set all three or none.
   */
  tokenPath?: string;
  tokenResponseHeader?: string;
  tokenRequestHeader?: string;
  /**
   * DOM events the widget fires after a successful add, so the store's theme
   * refreshes its cart count or drawer. A JSON array as text, at most 8 events:
   * `[{ "name": "cart:refresh" }, { "name": "x", "target": "window", "detail": { "type": "y" } }]`.
   * `target` is `"body"` (default, bubbling) or `"window"`; `detail` is a flat
   * object of strings, numbers and booleans. The widget always fires
   * `hay:cart-updated` on the body as well.
   */
  afterAddEvents?: string;
  /**
   * Dotted name of a global on the store's page that holds the path the
   * storefront lives under, for stores served from a locale folder (e.g.
   * `"Shopify.routes.root"` holding `"/en-ca/"`). The widget puts it in front
   * of `addPath`, `checkoutPath` and `tokenPath`. Ignored when the global is
   * missing or is not a path.
   */
  rootPathGlobal?: string;
}

/** A contribution prop is either a literal or a reference to a config field. */
export type WebchatContributionPropValue = string | number | boolean | ConfigFieldReference;

/** Options accepted by `register.webchat.contribution()`. */
export interface WebchatContributionOptions {
  /** Unique id within the plugin (`[a-z0-9_-]+`). */
  id: string;
  /** Fixed, versioned contribution type. */
  type: WebchatContributionType;
  /**
   * Props for the type. Use `config.field("name")` to pull a value from the
   * org's config (resolved by Core: org value, then env fallback, then default).
   * Encrypted fields are never resolved into public props.
   */
  props: Record<string, WebchatContributionPropValue>;
}

/**
 * Serialisable contribution descriptor exposed via `/metadata`.
 * Literal props live in `props`; config-backed props map prop name → field name.
 */
export interface WebchatContributionDescriptor {
  id: string;
  type: WebchatContributionType;
  props: Record<string, string | number | boolean>;
  configProps: Record<string, string>;
}

/** Widget actions a gate can guard. */
export type WebchatGateEvent = "conversation.create" | "message.send";

/** What Core does when the gate handler times out or errors. */
export type WebchatGateFailurePolicy = "open" | "closed";

/** Input Core passes to a gate handler. */
export interface WebchatGateInput {
  event: WebchatGateEvent;
  /** Token produced by a rendered contribution (e.g. a challenge token). */
  token?: string;
  /** Error code reported by the widget when the contribution could not run. */
  contributionError?: string;
  /** Hostname of the page embedding the widget (from Origin/Referer). */
  pageHostname?: string;
  /** Hostname that hosts Hay.chat-served frames (the API host). */
  frameHostname: string;
  /** Visitor IP as seen by Core. */
  ip?: string;
  /** True when the org is in under-attack mode: challenge everyone. */
  underAttack: boolean;
}

/**
 * Gate decision.
 * - `allow`: proceed.
 * - `deny`: refuse the action (the widget shows a verification failure).
 * - `flag`: proceed, but mark the conversation as unverified so the spam
 *   detector treats it with suspicion.
 */
export interface WebchatGateResult {
  decision: "allow" | "deny" | "flag";
  /** Short machine-readable reason, stored on the conversation. */
  reason?: string;
}

/** Context passed to a gate handler (org-scoped, like a cron context). */
export interface HayWebchatGateContext {
  org: HayOrg;
  config: HayConfigRuntimeAPI;
  logger: HayLogger;
}

export type WebchatGateHandler = (
  ctx: HayWebchatGateContext,
  input: WebchatGateInput,
) => Promise<WebchatGateResult> | WebchatGateResult;

/** Options for `register.webchat.gate()`. */
export interface WebchatGateOptions {
  /** Max time Core waits for the handler. Default 3000 ms, max 5000 ms. */
  timeoutMs?: number;
  /** What Core does on timeout/error. Default `"open"` (never lock visitors out). */
  failurePolicy?: WebchatGateFailurePolicy;
}

/** Serialisable gate descriptor exposed via `/metadata` (no handler). */
export interface WebchatGateDescriptor {
  event: WebchatGateEvent;
  timeoutMs: number;
  failurePolicy: WebchatGateFailurePolicy;
}

/** Webchat section of the `/metadata` response. */
export interface WebchatMetadata {
  contributions: WebchatContributionDescriptor[];
  gates: WebchatGateDescriptor[];
}

/** Webchat registration API (`register.webchat`). */
export interface RegisterWebchatAPI {
  /**
   * Declare a widget contribution.
   *
   * @example
   * ```typescript
   * register.webchat.contribution({
   *   id: 'challenge',
   *   type: 'challenge@1',
   *   props: { provider: 'turnstile', siteKey: config.field('siteKey'), mode: config.field('mode') },
   * });
   * ```
   */
  contribution(options: WebchatContributionOptions): void;

  /**
   * Register a synchronous server-side gate for a widget action.
   *
   * @example
   * ```typescript
   * register.webchat.gate('conversation.create', async (ctx, input) => {
   *   return input.token ? { decision: 'allow' } : { decision: 'flag', reason: 'no_token' };
   * }, { timeoutMs: 3000, failurePolicy: 'open' });
   * ```
   */
  gate(event: WebchatGateEvent, handler: WebchatGateHandler, options?: WebchatGateOptions): void;
}
