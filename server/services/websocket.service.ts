import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { processManagerService } from './process-manager.service';
import { pluginInstanceRepository } from '../repositories/plugin-instance.repository';
import { conversationRepository, ConversationRepository } from '../repositories/conversation.repository';
import { CustomerIdentifier } from '../../plugins/base';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';

interface WebSocketClient {
  ws: WebSocket;
  organizationId: string;
  customerId: string;
  conversationId?: string;
  pluginId?: string;
  authenticated: boolean;
  metadata: Record<string, any>;
}

export class WebSocketService {
  private wss?: WebSocketServer;
  private clients = new Map<string, WebSocketClient>();
  private conversationClients = new Map<string, Set<string>>();

  /**
   * Initialize WebSocket server
   * Can run on the same HTTP server or on a separate port
   */
  initialize(serverOrPort: Server | number): void {
    if (typeof serverOrPort === 'number') {
      // Standalone WebSocket server on a separate port
      this.wss = new WebSocketServer({ 
        port: serverOrPort,
        path: '/ws',
        clientTracking: true,
      });
      console.log(`🔌 WebSocket server initialized on standalone port ${serverOrPort}`);
    } else {
      // WebSocket server attached to existing HTTP server
      this.wss = new WebSocketServer({ 
        server: serverOrPort,
        path: '/ws',
        clientTracking: true,
      });
      console.log('🔌 WebSocket server initialized');
    }

    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, req: any): void {
    const clientId = this.generateClientId();
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const organizationId = url.searchParams.get('org');

    // Create client object
    const client: WebSocketClient = {
      ws,
      organizationId: organizationId || '',
      customerId: '',
      authenticated: false,
      metadata: {
        userAgent: req.headers['user-agent'],
        ip: req.socket.remoteAddress,
      },
    };

    this.clients.set(clientId, client);

    // Authenticate if token provided
    if (token) {
      this.authenticateClient(clientId, token);
    }

    // Set up event handlers
    ws.on('message', (data) => {
      this.handleMessage(clientId, data.toString());
    });

    ws.on('close', () => {
      this.handleDisconnect(clientId);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for client ${clientId}:`, error);
      this.handleDisconnect(clientId);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      clientId,
    }));
  }

  /**
   * Authenticate WebSocket client
   */
  private authenticateClient(clientId: string, token: string): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;

    try {
      const decoded = jwt.verify(token, config.jwt.secret) as any;
      client.organizationId = decoded.organizationId;
      client.authenticated = true;
      return true;
    } catch (error) {
      console.error('WebSocket authentication failed:', error);
      return false;
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  private async handleMessage(clientId: string, data: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'identify':
          await this.handleIdentify(clientId, message);
          break;

        case 'message':
          await this.handleChatMessage(clientId, message);
          break;

        case 'typing':
          await this.handleTypingIndicator(clientId, message);
          break;

        case 'load_history':
          await this.handleLoadHistory(clientId, message);
          break;

        case 'subscribe':
          await this.handleSubscribe(clientId, message);
          break;

        default:
          console.log(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`Failed to handle message from ${clientId}:`, error);
      client.ws.send(JSON.stringify({
        type: 'error',
        error: 'Invalid message format',
      }));
    }
  }

  /**
   * Handle customer identification
   */
  private async handleIdentify(clientId: string, message: any): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { customerId, conversationId, metadata } = message;

    // Update client info
    client.customerId = customerId;
    client.conversationId = conversationId;
    client.metadata = { ...client.metadata, ...metadata };

    // Get or create conversation
    let conversation;
    if (conversationId) {
      conversation = await conversationRepository.findById(conversationId);
      if (!conversation || conversation.organization_id !== client.organizationId) {
        return;
      }
    }

    if (!conversation && client.organizationId) {
      // Create new conversation
      conversation = await conversationRepository.create({
        organization_id: client.organizationId,
        customer_id: customerId,
        status: 'open',
        metadata: {
          source: 'webchat',
          ...metadata,
        },
      });
    }

    if (conversation) {
      client.conversationId = conversation.id;

      // Add to conversation clients map
      if (!this.conversationClients.has(conversation.id)) {
        this.conversationClients.set(conversation.id, new Set());
      }
      this.conversationClients.get(conversation.id)!.add(clientId);

      // Find webchat plugin instance
      const pluginInstances = await pluginInstanceRepository.findAll({
        where: {
          organizationId: client.organizationId,
          enabled: true,
        },
        relations: ['plugin'],
      });
      
      const pluginInstance = pluginInstances.find(
        instance => instance.plugin.name === 'hay-plugin-webchat'
      );

      if (pluginInstance && pluginInstance.plugin.name === 'hay-plugin-webchat') {
        client.pluginId = pluginInstance.pluginId;

        // Notify plugin of connection
        try {
          await processManagerService.sendToPlugin(
            client.organizationId,
            client.pluginId,
            'websocket_connected',
            {
              conversationId: conversation.id,
              customerId,
              metadata,
            }
          );
        } catch (error) {
          console.error('Failed to notify plugin of WebSocket connection:', error);
        }
      }
    }

    // Send identification confirmation
    client.ws.send(JSON.stringify({
      type: 'identified',
      conversationId: client.conversationId,
      customerId: client.customerId,
    }));
  }

  /**
   * Handle chat message
   */
  private async handleChatMessage(clientId: string, message: any): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client || !client.conversationId || !client.pluginId) return;

    // Forward to plugin
    try {
      await processManagerService.sendToPlugin(
        client.organizationId,
        client.pluginId,
        'websocket_message',
        {
          conversationId: client.conversationId,
          customerId: client.customerId,
          text: message.text,
          attachments: message.attachments,
          timestamp: message.timestamp,
        }
      );
    } catch (error) {
      console.error('Failed to forward message to plugin:', error);
      client.ws.send(JSON.stringify({
        type: 'error',
        error: 'Failed to send message',
      }));
    }
  }

  /**
   * Handle typing indicator
   */
  private async handleTypingIndicator(clientId: string, message: any): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client || !client.conversationId) return;

    // Broadcast to other clients in conversation
    this.broadcastToConversation(
      client.conversationId,
      {
        type: 'typing',
        userId: client.customerId,
        isTyping: message.isTyping,
      },
      clientId
    );
  }

  /**
   * Handle load history request
   */
  private async handleLoadHistory(clientId: string, message: any): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { conversationId } = message;
    
    // Load conversation with messages
    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation || conversation.organization_id !== client.organizationId) {
      return;
    }

    const messages = conversation?.messages || [];
    
    client.ws.send(JSON.stringify({
      type: 'history',
      messages: messages.map((msg: any) => ({
        text: msg.content,
        sender: msg.role === 'user' ? 'user' : 'agent',
        timestamp: msg.created_at,
        metadata: msg.metadata,
      })),
    }));
  }

  /**
   * Handle subscription request
   */
  private async handleSubscribe(clientId: string, message: any): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { conversationId } = message;
    
    // Add to conversation subscribers
    if (!this.conversationClients.has(conversationId)) {
      this.conversationClients.set(conversationId, new Set());
    }
    this.conversationClients.get(conversationId)!.add(clientId);
    
    client.conversationId = conversationId;
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove from conversation clients
    if (client.conversationId) {
      const conversationClients = this.conversationClients.get(client.conversationId);
      if (conversationClients) {
        conversationClients.delete(clientId);
        if (conversationClients.size === 0) {
          this.conversationClients.delete(client.conversationId);
        }
      }

      // Notify plugin of disconnection
      if (client.pluginId && client.organizationId) {
        processManagerService.sendToPlugin(
          client.organizationId,
          client.pluginId,
          'websocket_disconnected',
          {
            conversationId: client.conversationId,
            customerId: client.customerId,
          }
        ).catch(error => {
          console.error('Failed to notify plugin of WebSocket disconnection:', error);
        });
      }
    }

    // Remove client
    this.clients.delete(clientId);
  }

  /**
   * Send message to specific client
   */
  sendToClient(clientId: string, message: any): boolean {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    client.ws.send(JSON.stringify(message));
    return true;
  }

  /**
   * Send message to all clients in a conversation
   */
  sendToConversation(conversationId: string, message: any): number {
    const clientIds = this.conversationClients.get(conversationId);
    if (!clientIds) return 0;

    let sent = 0;
    for (const clientId of clientIds) {
      if (this.sendToClient(clientId, message)) {
        sent++;
      }
    }

    return sent;
  }

  /**
   * Broadcast to conversation except sender
   */
  broadcastToConversation(
    conversationId: string, 
    message: any, 
    excludeClientId?: string
  ): number {
    const clientIds = this.conversationClients.get(conversationId);
    if (!clientIds) return 0;

    let sent = 0;
    for (const clientId of clientIds) {
      if (clientId !== excludeClientId && this.sendToClient(clientId, message)) {
        sent++;
      }
    }

    return sent;
  }

  /**
   * Send message from plugin to conversation
   */
  sendPluginMessage(organizationId: string, conversationId: string, message: any): void {
    this.sendToConversation(conversationId, {
      type: 'message',
      data: message,
    });
  }

  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get connected clients count
   */
  getConnectionCount(): number {
    return this.clients.size;
  }

  /**
   * Get conversation clients count
   */
  getConversationCount(conversationId: string): number {
    return this.conversationClients.get(conversationId)?.size || 0;
  }

  /**
   * Shutdown WebSocket server
   */
  shutdown(): void {
    // Close all client connections
    for (const [clientId, client] of this.clients) {
      client.ws.close(1000, 'Server shutting down');
    }

    // Clear maps
    this.clients.clear();
    this.conversationClients.clear();

    // Close server
    if (this.wss) {
      this.wss.close();
    }
  }
}

export const websocketService = new WebSocketService();