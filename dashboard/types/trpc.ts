// tRPC types for the dashboard
import type { inferRouterOutputs, inferRouterInputs } from '@trpc/server';
import type { AppRouter } from '../../server/routes';

export type { AppRouter };
export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type RouterInputs = inferRouterInputs<AppRouter>;
