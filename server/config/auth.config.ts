import { config } from "./env";

export const authConfig = {
  jwt: {
    secret: config.jwt.secret,
    refreshSecret: config.jwt.refreshSecret,
    expiresIn: "15m",
    algorithm: "HS256" as const,
  },
  bcrypt: {
    saltRounds: 12,
  },
  argon2: {
    type: 2,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  },
  apiKey: {
    length: 32,
    prefix: "hay_",
  },
  session: {
    /** Counted from sign-in; refreshing never extends it. */
    absoluteLifetimeMs: 1000 * 60 * 60 * 24 * 30,
    cookieName: "hay_refresh",
    secure: config.domain.useSSL,
    httpOnly: true,
    sameSite: config.authCookie.sameSite,
  },
};
