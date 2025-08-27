import { CreateExpressContextOptions } from "@trpc/server/adapters/express";

export const createContext = async ({
  req,
  res,
}: CreateExpressContextOptions) => {
  const context = {};

  return context;
};
