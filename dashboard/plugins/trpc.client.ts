import { trpc } from '~/utils/trpc';

export default defineNuxtPlugin(() => {
  return {
    provide: {
      trpc
    }
  };
});