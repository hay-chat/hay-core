/**
 * Stand-in for `puppeteer-core` and `@puppeteer/browsers` under Jest.
 *
 * Both packages ship ESM only. Node loads them through require(esm) at runtime,
 * but Jest's CommonJS runtime on Node 22 cannot, and no test drives a real
 * browser. Suites that render pages mock `headless-browser.service` instead.
 */
function unavailable(): never {
  throw new Error("puppeteer is not available under Jest; mock headless-browser.service");
}

export default { launch: unavailable };
export const install = unavailable;
export const resolveBuildId = unavailable;
export const detectBrowserPlatform = unavailable;
export const Browser = { CHROMIUM: "chromium" };
