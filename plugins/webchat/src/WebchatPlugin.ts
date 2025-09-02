import { 
  ChatConnectorPlugin, 
  IncomingMessage, 
  OutgoingMessage, 
  WebhookRequest, 
  WebhookResponse,
  PublicAsset,
  HayPluginManifest 
} from '../../base';
import { MessageHandler } from './handlers/message.handler';
import path from 'path';
import fs from 'fs/promises';

export class WebchatPlugin extends ChatConnectorPlugin {
  private messageHandler: MessageHandler;
  private connectedClients = new Map<string, any>();

  constructor(manifest: HayPluginManifest) {
    super(manifest);
    this.messageHandler = new MessageHandler();
  }

  /**
   * Handle incoming message from webchat widget
   */
  protected async onMessageReceived(message: IncomingMessage): Promise<void> {
    this.log('info', 'Message received from webchat', { 
      conversationId: message.conversationId,
      userId: message.userId,
      text: message.text,
    });

    // Forward to Hay conversation system
    await this.forwardToHay(message);
  }

  /**
   * Send message to webchat widget
   */
  protected async sendOutgoingMessage(message: OutgoingMessage): Promise<void> {
    this.log('info', 'Sending message to webchat', {
      conversationId: message.conversationId,
      text: message.text,
    });

    // Send via WebSocket to connected client
    const client = this.connectedClients.get(message.conversationId);
    if (client) {
      client.send(JSON.stringify({
        type: 'message',
        data: message,
      }));
    } else {
      this.log('warn', 'No connected client for conversation', {
        conversationId: message.conversationId,
      });
    }
  }

  /**
   * Handle webhook requests (for fallback/HTTP messaging)
   */
  protected async handleWebhook(request: WebhookRequest): Promise<WebhookResponse> {
    if (request.path === '/message' && request.method === 'POST') {
      const { conversationId, userId, text, attachments } = request.body;

      const message: IncomingMessage = {
        id: `msg_${Date.now()}`,
        conversationId,
        userId,
        text,
        attachments,
        metadata: {
          source: 'webchat',
          ip: request.headers['x-forwarded-for'] || request.headers['x-real-ip'],
        },
        timestamp: new Date(),
      };

      await this.onMessageReceived(message);

      return {
        status: 200,
        body: { success: true, messageId: message.id },
      };
    }

    return {
      status: 404,
      body: { error: 'Webhook not found' },
    };
  }

  /**
   * Get public assets (widget script and styles)
   */
  protected async getPublicAssets(): Promise<PublicAsset[]> {
    const assets: PublicAsset[] = [];

    // Get widget configuration
    const config = this.getContext()?.config || {};

    // Load widget script template
    const scriptPath = path.join(__dirname, '../widget/widget.js');
    const stylePath = path.join(__dirname, '../widget/widget.css');

    try {
      // Read widget script
      let scriptContent = await fs.readFile(scriptPath, 'utf-8');
      
      // Inject configuration into script
      scriptContent = scriptContent.replace(
        '__WIDGET_CONFIG__',
        JSON.stringify(config)
      );

      assets.push({
        path: 'widget.js',
        content: scriptContent,
        contentType: 'application/javascript',
        cache: true,
      });

      // Read widget styles
      let styleContent = await fs.readFile(stylePath, 'utf-8');
      
      // Apply theme colors
      styleContent = this.applyTheme(styleContent, config.theme || 'blue');

      assets.push({
        path: 'widget.css',
        content: styleContent,
        contentType: 'text/css',
        cache: true,
      });
    } catch (error) {
      this.log('error', 'Failed to load widget assets', { error });
    }

    return assets;
  }

  /**
   * Apply theme colors to CSS
   */
  private applyTheme(css: string, theme: string): string {
    const themes = {
      blue: {
        primary: '#3B82F6',
        primaryDark: '#2563EB',
        primaryLight: '#60A5FA',
      },
      green: {
        primary: '#10B981',
        primaryDark: '#059669',
        primaryLight: '#34D399',
      },
      purple: {
        primary: '#8B5CF6',
        primaryDark: '#7C3AED',
        primaryLight: '#A78BFA',
      },
      black: {
        primary: '#000000',
        primaryDark: '#171717',
        primaryLight: '#404040',
      },
    };

    const colors = themes[theme as keyof typeof themes] || themes.blue;

    return css
      .replace(/--hay-primary:/g, `--hay-primary: ${colors.primary};`)
      .replace(/--hay-primary-dark:/g, `--hay-primary-dark: ${colors.primaryDark};`)
      .replace(/--hay-primary-light:/g, `--hay-primary-light: ${colors.primaryLight};`);
  }

  /**
   * Render configuration UI
   */
  protected async renderConfiguration(): Promise<string> {
    // Load custom configuration template
    const templatePath = path.join(__dirname, '../ui/configuration.vue');
    
    try {
      const template = await fs.readFile(templatePath, 'utf-8');
      return template;
    } catch (error) {
      this.log('error', 'Failed to load configuration template', { error });
      // Return null to use auto-generated template
      return '';
    }
  }

  /**
   * Handle WebSocket connection
   */
  async handleWebSocketConnection(ws: any, conversationId: string): Promise<void> {
    this.log('info', 'WebSocket client connected', { conversationId });
    
    this.connectedClients.set(conversationId, ws);

    // Send greeting if configured
    const config = this.getContext()?.config || {};
    if (config.showGreeting && config.greetingMessage) {
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'message',
          data: {
            conversationId,
            text: config.greetingMessage,
            metadata: { isGreeting: true },
          },
        }));
      }, 1000);
    }

    // Handle incoming messages
    ws.on('message', async (data: string) => {
      try {
        const payload = JSON.parse(data);
        
        if (payload.type === 'message') {
          const message: IncomingMessage = {
            id: `msg_${Date.now()}`,
            conversationId,
            userId: payload.userId || 'anonymous',
            text: payload.text,
            attachments: payload.attachments,
            metadata: {
              source: 'webchat',
              websocket: true,
            },
            timestamp: new Date(),
          };

          await this.onMessageReceived(message);
        } else if (payload.type === 'typing') {
          // Handle typing indicator
          super.sendMessage({
            type: 'custom',
            payload: {
              action: 'typing',
              data: {
                conversationId,
                isTyping: payload.isTyping,
              },
            },
          });
        }
      } catch (error) {
        this.log('error', 'Failed to process WebSocket message', { error });
      }
    });

    // Handle disconnect
    ws.on('close', () => {
      this.log('info', 'WebSocket client disconnected', { conversationId });
      this.connectedClients.delete(conversationId);
    });

    ws.on('error', (error: Error) => {
      this.log('error', 'WebSocket error', { error, conversationId });
      this.connectedClients.delete(conversationId);
    });
  }

  /**
   * Initialize plugin
   */
  protected async onInitialize(config?: Record<string, any>): Promise<void> {
    await super.onInitialize(config);
    this.log('info', 'Webchat plugin initialized', { config });
  }

  /**
   * Shutdown plugin
   */
  protected async onShutdown(): Promise<void> {
    // Close all WebSocket connections
    for (const [conversationId, client] of this.connectedClients) {
      try {
        client.close();
      } catch (error) {
        this.log('error', 'Failed to close WebSocket connection', { 
          error, 
          conversationId 
        });
      }
    }
    
    this.connectedClients.clear();
    await super.onShutdown();
  }
}