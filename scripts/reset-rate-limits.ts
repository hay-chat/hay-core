/**
 * Script to reset rate limit keys in Redis
 *
 * Clears all rate limit counters, useful when locked out during development.
 *
 * Run with: npm run reset:rate-limits
 *
 * Options:
 *   --dry-run    Show keys that would be deleted without actually deleting
 *   --pattern    Custom pattern to match (default: all rate limit keys)
 */

import Redis from "ioredis";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const RATE_LIMIT_PATTERNS = ["rate_limit:*", "ratelimit:*"];

async function resetRateLimits() {
  const isDryRun = process.argv.includes("--dry-run");
  const customPattern = process.argv.find((arg) => arg.startsWith("--pattern="))?.split("=")[1];

  const redisConfig: Record<string, unknown> = {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || "0", 10),
    maxRetriesPerRequest: 3,
    connectTimeout: 5000,
  };

  if (process.env.REDIS_TLS === "true") {
    redisConfig.tls = {};
  }

  const redis = new Redis(redisConfig as any);

  try {
    console.log("Connecting to Redis...");
    await redis.ping();
    console.log("Connected.\n");

    const patterns = customPattern ? [customPattern] : RATE_LIMIT_PATTERNS;
    let totalDeleted = 0;

    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);

      if (keys.length === 0) {
        console.log(`No keys matching "${pattern}"`);
        continue;
      }

      console.log(`Found ${keys.length} keys matching "${pattern}":`);
      for (const key of keys) {
        const ttl = await redis.ttl(key);
        console.log(`  ${key} (TTL: ${ttl > 0 ? `${ttl}s` : "no expiry"})`);
      }

      if (!isDryRun) {
        await redis.del(...keys);
        console.log(`Deleted ${keys.length} keys.\n`);
      } else {
        console.log(`(dry-run) Would delete ${keys.length} keys.\n`);
      }

      totalDeleted += keys.length;
    }

    if (totalDeleted === 0) {
      console.log("No rate limit keys found. You're not rate-limited.");
    } else if (!isDryRun) {
      console.log(`Done. Cleared ${totalDeleted} rate limit keys.`);
    }
  } catch (error: any) {
    if (error.code === "ECONNREFUSED") {
      console.error("Could not connect to Redis. Is it running?");
    } else {
      console.error("Error:", error.message);
    }
    process.exit(1);
  } finally {
    redis.disconnect();
  }
}

resetRateLimits();
