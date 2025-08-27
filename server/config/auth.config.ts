import { config } from './env';

export const authConfig = {
  jwt: {
    secret: config.jwt.secret,
    expiresIn: '15m',
    refreshExpiresIn: config.jwt.refreshExpiresIn,
    algorithm: 'HS256' as const,
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
    prefix: 'hay_',
  },
  session: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict' as const,
  },
  rateLimit: {
    login: {
      windowMs: 15 * 60 * 1000,
      max: 5,
    },
    apiKey: {
      windowMs: 15 * 60 * 1000,
      max: 100,
    },
  },
};