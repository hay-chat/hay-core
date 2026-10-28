/**
 * Plugin contribution types this widget build can render. The loader sends
 * them to the server, which only returns contributions of these types.
 * Kept free of Vue so the loader bundle stays small.
 */
export const SUPPORTED_CONTRIBUTIONS = ["challenge@1"] as const;
