import { Hay } from "@/utils/api";

type CallUiRouteInput = Parameters<typeof Hay.plugins.callUiRoute.mutate>[0];
type ConfigureInput = Parameters<typeof Hay.plugins.configure.mutate>[0];
type CompleteWithCodeInput = Parameters<typeof Hay.plugins.oauth.completeWithCode.mutate>[0];
type CreateEmailDomainInput = Parameters<typeof Hay.emailDomains.create.mutate>[0];

/**
 * The client a plugin UI component receives as its `api` prop. It is a plain
 * object listing the only procedures plugin UIs call, not the dashboard's
 * tRPC proxy, so anything else is simply absent. Every call that names a
 * plugin is bound to the plugin the component was loaded for.
 *
 * A plugin UI that needs another procedure has to be added here.
 */
export function createPluginUiApi(pluginId: string) {
  return {
    plugins: {
      callUiRoute: {
        mutate: (input: CallUiRouteInput) => Hay.plugins.callUiRoute.mutate({ ...input, pluginId }),
      },
      configure: {
        mutate: (input: ConfigureInput) => Hay.plugins.configure.mutate({ ...input, pluginId }),
      },
      oauth: {
        completeWithCode: {
          mutate: (input: CompleteWithCodeInput) =>
            Hay.plugins.oauth.completeWithCode.mutate({ ...input, pluginId }),
        },
      },
    },
    emailDomains: {
      get: { query: () => Hay.emailDomains.get.query() },
      create: { mutate: (input: CreateEmailDomainInput) => Hay.emailDomains.create.mutate(input) },
      verify: { mutate: () => Hay.emailDomains.verify.mutate() },
      remove: { mutate: () => Hay.emailDomains.remove.mutate() },
    },
  };
}
