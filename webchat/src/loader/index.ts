// widget.js: the small script every page loads. It paints the button, checks
// the widget settings and loads the chat chunk when it is needed (see boot.ts).
// Served with a short cache; the chunk it points to is hashed and immutable.
import type { HayChatConfig } from "@/types";
import { boot, type ChatModule } from "./boot";

const defaultConfig: HayChatConfig = {
  organizationId: "",
  baseUrl: "http://localhost:3001",
  position: "right",
  theme: "blue",
  showGreeting: true,
};

const config: HayChatConfig = { ...defaultConfig, ...window.HayChat?.config };

// The chunk sits next to widget.js. currentScript is only set while this
// script runs, so resolve the URL now.
const scriptUrl =
  (document.currentScript as HTMLScriptElement | null)?.src ||
  `${config.baseUrl}/v1/webchat/widget.js`;
const chatUrl = new URL(__HAY_CHAT_ENTRY__, scriptUrl).href;

const start = () => boot(config, () => import(/* @vite-ignore */ chatUrl) as Promise<ChatModule>);

if (document.body) start();
else document.addEventListener("DOMContentLoaded", start, { once: true });
