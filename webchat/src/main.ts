import { createApp } from 'vue';
import Widget from './Widget.vue';
import type { HayChatConfig } from './types';
import './styles/widget.css';

// Get config from window object or use defaults
const defaultConfig: HayChatConfig = {
  organizationId: '',
  baseUrl: 'http://localhost:3001',
  widgetTitle: 'Chat with us',
  widgetSubtitle: 'We typically reply within minutes',
  position: 'right',
  theme: 'blue',
  showGreeting: true,
  greetingMessage: 'Hello! How can we help you today?',
};

const config = { ...defaultConfig, ...window.HayChat?.config };

// Validate required config
if (!config.organizationId) {
  console.error('[Hay Webchat] organizationId is required in config');
}

if (!config.baseUrl) {
  console.error('[Hay Webchat] baseUrl is required in config');
}

// Create widget container
const container = document.createElement('div');
container.id = 'hay-webchat-root';
container.setAttribute('data-theme', config.theme || 'blue');
document.body.appendChild(container);

// Mount the widget
const app = createApp(Widget, { config });
app.mount(container);

console.log('[Hay Webchat] Widget loaded', { organizationId: config.organizationId });
