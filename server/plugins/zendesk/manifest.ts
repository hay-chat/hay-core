import { HayPlugin } from '../HayPlugin';

export const zendesk = new HayPlugin({
  name: 'Zendesk',
  version: '1.0.0',
  description: 'Zendesk integration plugin for Hay',
  author: 'Hay Team',
  settings: {
    subdomain: process.env.ZENDESK_SUBDOMAIN || '',
    email: process.env.ZENDESK_EMAIL || '',
    apiToken: process.env.ZENDESK_API_TOKEN || '',
    oauthToken: process.env.ZENDESK_OAUTH_TOKEN || '',
    ticketFormId: process.env.ZENDESK_TICKET_FORM_ID || '',
    defaultPriority: process.env.ZENDESK_DEFAULT_PRIORITY || 'normal',
    defaultStatus: process.env.ZENDESK_DEFAULT_STATUS || 'new',
    customFieldMappings: process.env.ZENDESK_CUSTOM_FIELDS ? 
      JSON.parse(process.env.ZENDESK_CUSTOM_FIELDS) : {},
    enableAutoTicketCreation: process.env.ZENDESK_AUTO_TICKET === 'true',
    syncInterval: parseInt(process.env.ZENDESK_SYNC_INTERVAL || '300000'), // 5 minutes default
    webhookSecret: process.env.ZENDESK_WEBHOOK_SECRET || ''
  },
  enabled: true,
  dependencies: []
});