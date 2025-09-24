export interface HayPluginManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  type: Array<
    "mcp-connector" | "retriever" | "playbook" | "document_importer" | "channel" | "system"
  >;
  entry: string;
  autoActivate?: boolean;
  invisible?: boolean;
  menuItems?: Array<{
    id: string;
    title: string;
    url: string;
    icon?: string;
    parent?: "settings" | "integrations" | "root";
    position?: number;
  }>;
  hooks?: string[];
  apiEndpoints?: Array<{
    path: string;
    method: "GET" | "POST" | "PUT" | "DELETE";
    handler: string;
  }>;
  trpcRouter?: string;
  services?: Array<{
    name: string;
    path: string;
    singleton?: boolean;
  }>;
  dashboardPages?: Array<{
    route: string;
    component: string;
  }>;
  capabilities?: {
    system?: {
      database?: boolean;
    };
    document_importer?: {
      name: string;
      description: string;
      icon?: string;
      supportedFormats?: string[];
      configSchema?: Record<string, unknown>;
    };
    mcp?: {
      tools?: Array<{
        name: string;
        input_schema: string | object;
        label?: string;
        description?: string;
      }>;
      transport?: string;
      auth?: Array<"oauth2" | "jwt" | "apiKey">;
      installCommand?: string;
      buildCommand?: string;
      startCommand?: string;
    };
    chat_connector?: {
      type: "webhook" | "polling" | "websocket";
      webhooks?: Array<{
        path: string;
        method: "GET" | "POST" | "PUT" | "DELETE";
        verificationToken?: boolean;
        signatureHeader?: string;
      }>;
      publicAssets?: Array<{
        path: string;
        file: string;
        type: "script" | "stylesheet" | "image";
      }>;
      realtime?: {
        type: "websocket" | "sse";
        path?: string;
      };
      features?: {
        fileUpload?: boolean;
        inlineKeyboards?: boolean;
        voiceMessages?: boolean;
        videoMessages?: boolean;
        typing?: boolean;
        readReceipts?: boolean;
      };
    };
  };
  permissions?: {
    env?: string[];
    scopes?: string[];
    database?: boolean;
  };
  configSchema?: Record<
    string,
    {
      type: string;
      description?: string;
      label?: string;
      placeholder?: string;
      required?: boolean;
      default?: unknown;
      options?: Array<{ label: string; value: unknown }>;
      regex?: string;
      env?: string;
      encrypted?: boolean;
    }
  >;
  ui?: {
    auth?: string;
    settings?: boolean;
    configuration?: string;
    templates?: Record<string, string>;
  };
}

export interface PublicAsset {
  path: string;
  content: string | Buffer;
  contentType: string;
  cache?: boolean;
}

export interface WebhookRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: any;
  query: Record<string, string>;
}

export interface WebhookResponse {
  status: number;
  headers?: Record<string, string>;
  body?: any;
}
