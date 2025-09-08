export interface HayPluginManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  type: Array<
    "mcp-connector" | "retriever" | "playbook" | "document_importer" | "channel"
  >;
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
  };
  configSchema?: Record<
    string,
    {
      type: string;
      description?: string;
      label?: string;
      placeholder?: string;
      required?: boolean;
      default?: any;
      options?: Array<{ label: string; value: any }>;
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
