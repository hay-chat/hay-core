/**
 * Meta Embedded Signup (v4) in the browser: load the FB JS SDK on demand, open
 * the signup popup and collect the 30-second code plus the session info Meta
 * posts back via `window.postMessage`.
 */

const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";
const GRAPH_VERSION = "v26.0";
const SDK_LOAD_TIMEOUT_MS = 15000;
/** How long to wait for the session-info message once the popup returned a code (code TTL is 30 s). */
const SESSION_WAIT_WITH_CODE_MS = 5000;
/** Short grace period to pick up a CANCEL/ERROR message when there is no code. */
const SESSION_WAIT_WITHOUT_CODE_MS = 1000;

interface FacebookLoginResponse {
  status?: string;
  authResponse?: { code?: string } | null;
}

interface FacebookSdk {
  init(options: {
    appId: string;
    autoLogAppEvents: boolean;
    xfbml: boolean;
    version: string;
  }): void;
  login(
    callback: (response: FacebookLoginResponse) => void,
    options: {
      config_id: string;
      response_type: "code";
      override_default_response_type: boolean;
      extras: { setup: Record<string, never> };
    },
  ): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

export type SignupEvent =
  | "FINISH"
  | "FINISH_ONLY_WABA"
  | "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
  | "CANCEL"
  | "ERROR";

const SIGNUP_EVENTS: readonly string[] = [
  "FINISH",
  "FINISH_ONLY_WABA",
  "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
  "CANCEL",
  "ERROR",
];

export interface SignupSession {
  event: SignupEvent;
  phoneNumberId?: string;
  wabaId?: string;
  businessId?: string;
  currentStep?: string;
  errorMessage?: string;
}

export interface SignupResult {
  code?: string;
  session: SignupSession | null;
}

let sdkPromise: Promise<FacebookSdk> | null = null;
let initializedAppId: string | null = null;

function initialize(fb: FacebookSdk, appId: string): FacebookSdk {
  if (initializedAppId !== appId) {
    fb.init({ appId, autoLogAppEvents: true, xfbml: false, version: GRAPH_VERSION });
    initializedAppId = appId;
  }
  return fb;
}

/** Load (once) and initialise the FB JS SDK. Only call from a user action. */
export function loadFacebookSdk(appId: string): Promise<FacebookSdk> {
  if (window.FB) {
    return Promise.resolve(initialize(window.FB, appId));
  }
  if (!sdkPromise) {
    sdkPromise = new Promise<FacebookSdk>((resolve, reject) => {
      const script = document.createElement("script");
      const fail = (message: string) => {
        clearTimeout(timeout);
        script.remove();
        sdkPromise = null;
        reject(new Error(message));
      };
      const timeout = setTimeout(
        () => fail("Timed out loading the Facebook SDK"),
        SDK_LOAD_TIMEOUT_MS,
      );

      window.fbAsyncInit = () => {
        clearTimeout(timeout);
        if (window.FB) {
          resolve(window.FB);
        } else {
          fail("Facebook SDK did not initialise");
        }
      };
      script.src = SDK_URL;
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.onerror = () => fail("Failed to load the Facebook SDK");
      document.body.appendChild(script);
    });
  }
  return sdkPromise.then((fb) => initialize(fb, appId));
}

function isFacebookOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "facebook.com" || hostname.endsWith(".facebook.com");
  } catch {
    return false;
  }
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === "string" && value) {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

/** Parse a `WA_EMBEDDED_SIGNUP` message from Meta; anything else returns null. */
export function parseSignupMessage(event: MessageEvent): SignupSession | null {
  if (!isFacebookOrigin(event.origin)) {
    return null;
  }
  let payload: unknown = event.data;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const message = payload as { type?: unknown; event?: unknown; data?: unknown };
  if (message.type !== "WA_EMBEDDED_SIGNUP" || typeof message.event !== "string") {
    return null;
  }
  if (!SIGNUP_EVENTS.includes(message.event)) {
    return null;
  }
  const data =
    typeof message.data === "object" && message.data !== null
      ? (message.data as Record<string, unknown>)
      : {};
  return {
    event: message.event as SignupEvent,
    phoneNumberId: optionalString(data.phone_number_id),
    wabaId: optionalString(data.waba_id),
    businessId: optionalString(data.business_id),
    currentStep: optionalString(data.current_step),
    errorMessage: optionalString(data.error_message),
  };
}

/**
 * Open the Embedded Signup popup. `FB.login` is called synchronously so the
 * click's user activation still applies (popup blockers). Resolves once the
 * popup closed and the session info arrived (or the wait ran out).
 */
export function runEmbeddedSignup(fb: FacebookSdk, configId: string): Promise<SignupResult> {
  return new Promise<SignupResult>((resolve, reject) => {
    let session: SignupSession | null = null;
    let code: string | undefined;
    let loginReturned = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve({ code, session });
    };

    function onMessage(event: MessageEvent) {
      const parsed = parseSignupMessage(event);
      if (!parsed) {
        return;
      }
      session = parsed;
      if (loginReturned) {
        finish();
      }
    }

    window.addEventListener("message", onMessage);
    try {
      // FB.login rejects async callbacks — keep this a plain function.
      fb.login(
        (response) => {
          loginReturned = true;
          code = response.authResponse?.code || undefined;
          if (session) {
            finish();
            return;
          }
          timer = setTimeout(
            finish,
            code ? SESSION_WAIT_WITH_CODE_MS : SESSION_WAIT_WITHOUT_CODE_MS,
          );
        },
        {
          config_id: configId,
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {} },
        },
      );
    } catch (error: unknown) {
      window.removeEventListener("message", onMessage);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
