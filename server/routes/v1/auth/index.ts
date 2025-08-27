import { t } from "@/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

const loginSchema = z.object({
  email: z.string(),
  password: z.string(),
});

const registerSchema = z.object({
  email: z.string(),
  password: z.string(),
});

export const authRouter = t.router({
  login: t.procedure.input(loginSchema).mutation(async ({ input }) => {
    const { email, password } = input;
  }),
  register: t.procedure.input(registerSchema).mutation(async ({ input }) => {
    const { email, password } = input;
  }),
  logout: t.procedure.mutation(async ({ ctx }) => {
    const { user } = ctx;
  }),
});
