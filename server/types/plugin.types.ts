export interface HayPluginManifest {
  name: string;
  version: string;
  type: Array<"mcp-connector" | "retriever" | "playbook" | "document_importer">;
  entry: string;
  capabilities?: {
    document_importer?: {
      name: string;
      description: string;
      icon?: string;
      supportedFormats?: string[];
      configSchema?: Record<string, any>;
    };
    mcp?: {
      tools?: Array<{
        name: string;
        input_schema: string | object;
      }>;
      transport?: string;
      auth?: Array<"oauth2" | "jwt" | "apiKey">;
      installCommand?: string;
      buildCommand?: string;
      startCommand?: string;
    };
  };
  permissions?: {
    env?: string[];
    scopes?: string[];
  };
  configSchema?: Record<
    string,
    {
      type: string;
      description?: string;
      label?: string;
      required?: boolean;
      regex?: string;
      env?: string;
      encrypted?: boolean;
    }
  >;
  ui?: {
    auth?: string;
    settings?: boolean;
  };
}