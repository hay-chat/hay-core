export default defineI18nConfig(() => ({
  legacy: false,
  locale: "en",
  fallbackLocale: "en",
  missingWarn: process.env.NODE_ENV === "development",
  fallbackWarn: false,
}));
