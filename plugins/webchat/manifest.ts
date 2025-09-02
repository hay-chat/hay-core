import type { HayPluginManifest } from "../base";

export const manifest: HayPluginManifest = {
  id: "hay-plugin-webchat",
  name: "Web Chat Widget",
  description: "A customizable web chat widget for your website with real-time messaging",
  version: "1.0.0",
  type: ["chat-connector"],
  entry: "./dist/index.js",
  capabilities: {
    chat_connector: {
      type: "websocket",
      webhooks: [
        {
          path: "/message",
          method: "POST",
          verificationToken: false,
        },
      ],
      publicAssets: [
        {
          path: "widget.js",
          file: "dist/widget/widget.js",
          type: "script",
        },
        {
          path: "widget.css",
          file: "dist/widget/widget.css",
          type: "stylesheet",
        },
      ],
      realtime: {
        type: "websocket",
        path: "/ws",
      },
      features: {
        fileUpload: true,
        typing: true,
        readReceipts: true,
      },
    },
  },
  permissions: {
    env: ["BASE_URL", "WEBSOCKET_URL"],
    scopes: ["org:<orgId>:chat:send", "org:<orgId>:chat:receive"],
  },
  configSchema: {
    widgetTitle: {
      type: "string",
      description: "The title displayed in the chat widget header",
      label: "Widget Title",
      placeholder: "e.g., Chat with us",
      required: true,
      default: "Chat with us",
    },
    widgetSubtitle: {
      type: "string",
      description: "The subtitle displayed below the title",
      label: "Widget Subtitle",
      placeholder: "e.g., We typically reply within minutes",
      required: false,
      default: "We typically reply within minutes",
    },
    position: {
      type: "select",
      description: "Where the chat widget appears on the page",
      label: "Position",
      required: true,
      default: "right",
      options: [
        { label: "Bottom Right", value: "right" },
        { label: "Bottom Left", value: "left" },
      ],
    },
    theme: {
      type: "select",
      description: "The color theme for the chat widget",
      label: "Theme",
      required: true,
      default: "blue",
      options: [
        { label: "Blue", value: "blue" },
        { label: "Green", value: "green" },
        { label: "Purple", value: "purple" },
        { label: "Black", value: "black" },
      ],
    },
    showGreeting: {
      type: "boolean",
      description: "Show a greeting message when the chat opens",
      label: "Show Greeting Message",
      required: false,
      default: true,
    },
    greetingMessage: {
      type: "textarea",
      description: "The greeting message to display",
      label: "Greeting Message",
      placeholder: "e.g., Hello! How can we help you today?",
      required: false,
      default: "Hello! How can we help you today?",
    },
    allowedDomains: {
      type: "textarea",
      description: "List of domains where the widget can be embedded (one per line)",
      label: "Allowed Domains",
      placeholder: "example.com\napp.example.com\n*.example.com",
      required: false,
      default: "*",
    },
  },
  ui: {
    settings: true,
    configuration: "src/ui/configuration.vue",
  },
};