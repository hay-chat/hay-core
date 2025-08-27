import { HayPlugin } from '../HayPlugin';

export const webchat = new HayPlugin({
  name: 'WebChat',
  version: '1.0.0',
  description: 'Web chat widget integration plugin for Hay',
  author: 'Hay Team',
  settings: {
    widgetId: process.env.WEBCHAT_WIDGET_ID || '',
    apiEndpoint: process.env.WEBCHAT_API_ENDPOINT || '/api/webchat',
    theme: process.env.WEBCHAT_THEME || 'light',
    position: process.env.WEBCHAT_POSITION || 'bottom-right',
    autoOpen: process.env.WEBCHAT_AUTO_OPEN === 'true',
    welcomeMessage: process.env.WEBCHAT_WELCOME_MESSAGE || 'Hello! How can I help you today?',
    offlineMessage: process.env.WEBCHAT_OFFLINE_MESSAGE || 'We are currently offline. Please leave a message.',
    enableFileUpload: process.env.WEBCHAT_ENABLE_FILE_UPLOAD !== 'false',
    maxFileSize: parseInt(process.env.WEBCHAT_MAX_FILE_SIZE || '5242880'), // 5MB default
    allowedFileTypes: process.env.WEBCHAT_ALLOWED_FILE_TYPES?.split(',') || ['image/*', 'application/pdf']
  },
  enabled: true,
  dependencies: []
});