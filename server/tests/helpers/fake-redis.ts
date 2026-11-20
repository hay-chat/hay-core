/** The few Redis commands the plugin API token deny-list uses, held in memory. */
export function createFakeRedisClient() {
  const keys = new Map<string, string>();
  /** Seconds given with `EX`, by key. */
  const ttls = new Map<string, number>();
  return {
    ttls,
    async set(key: string, value: string, ...options: unknown[]): Promise<"OK"> {
      keys.set(key, value);
      const ex = options.indexOf("EX");
      if (ex >= 0 && typeof options[ex + 1] === "number") ttls.set(key, options[ex + 1] as number);
      return "OK";
    },
    async exists(key: string): Promise<number> {
      return keys.has(key) ? 1 : 0;
    },
  };
}
