import { HayPlugin } from '../HayPlugin';

export const openai = new HayPlugin({
  name: 'OpenAI',
  version: '1.0.0',
  description: 'OpenAI integration plugin for Hay',
  author: 'Hay Team',
  settings: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4',
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.7'),
    maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '2000'),
    organizationId: process.env.OPENAI_ORG_ID || '',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  },
  enabled: true,
  dependencies: []
});