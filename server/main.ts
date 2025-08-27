import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express from "express";
import { config } from "@/config/env";
import { appRouter } from "@/routes";

const server = express();
server.use("/trpc", createExpressMiddleware({ router: appRouter }));

server.listen(config.server.port, () => {
  console.log(`Server is running on port ${config.server.port}`);
});
