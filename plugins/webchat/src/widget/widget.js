(function(window, document) {
  'use strict';

  // Widget configuration (injected by server)
  const config = window.HayChat?.config || __WIDGET_CONFIG__;
  
  // Customer identification
  const STORAGE_KEY = 'hay_chat_customer_id';
  const CONVERSATION_KEY = 'hay_chat_conversation_id';
  
  class HayWebchat {
    constructor(config) {
      this.config = config;
      this.ws = null;
      this.isOpen = false;
      this.messages = [];
      this.customerId = this.getOrCreateCustomerId();
      this.conversationId = this.getConversationId();
      this.reconnectAttempts = 0;
      this.maxReconnectAttempts = 5;
      this.reconnectDelay = 1000;
    }

    /**
     * Get or create persistent customer ID
     */
    getOrCreateCustomerId() {
      // Check if customer ID was provided in config
      if (this.config.customerId) {
        localStorage.setItem(STORAGE_KEY, this.config.customerId);
        return this.config.customerId;
      }

      // Check if external ID was provided
      if (this.config.externalId) {
        const customerId = `ext_${this.config.externalId}`;
        localStorage.setItem(STORAGE_KEY, customerId);
        return customerId;
      }

      // Check localStorage for existing anonymous ID
      let customerId = localStorage.getItem(STORAGE_KEY);
      if (!customerId) {
        // Generate new anonymous customer ID
        customerId = 'anon_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem(STORAGE_KEY, customerId);
      }

      return customerId;
    }

    /**
     * Get existing conversation ID
     */
    getConversationId() {
      return sessionStorage.getItem(CONVERSATION_KEY);
    }

    /**
     * Save conversation ID
     */
    saveConversationId(conversationId) {
      this.conversationId = conversationId;
      sessionStorage.setItem(CONVERSATION_KEY, conversationId);
    }

    /**
     * Initialize the widget
     */
    init() {
      this.createWidget();
      this.attachEventListeners();
      this.connectWebSocket();

      // Load previous messages if conversation exists
      if (this.conversationId) {
        this.loadConversationHistory();
      }
    }

    /**
     * Create widget HTML
     */
    createWidget() {
      const position = this.config.position || 'right';
      const theme = this.config.theme || 'blue';

      // Create widget container
      const widget = document.createElement('div');
      widget.id = 'hay-webchat-widget';
      widget.className = `hay-widget hay-position-${position} hay-theme-${theme}`;
      widget.innerHTML = `
        <div class="hay-widget-button" id="hay-widget-button">
          <svg class="hay-widget-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
          </svg>
          <span class="hay-widget-badge" id="hay-unread-badge" style="display: none;">0</span>
        </div>
        
        <div class="hay-widget-window" id="hay-widget-window" style="display: none;">
          <div class="hay-widget-header">
            <div class="hay-widget-header-content">
              <h3 class="hay-widget-title">${this.config.widgetTitle || 'Chat with us'}</h3>
              <p class="hay-widget-subtitle">${this.config.widgetSubtitle || ''}</p>
            </div>
            <button class="hay-widget-close" id="hay-widget-close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          
          <div class="hay-widget-messages" id="hay-messages">
            <div class="hay-widget-messages-container" id="hay-messages-container">
              <!-- Messages will be inserted here -->
            </div>
          </div>
          
          <div class="hay-widget-input">
            <form id="hay-message-form">
              <input 
                type="text" 
                id="hay-message-input" 
                placeholder="Type your message..." 
                autocomplete="off"
              />
              <button type="submit" class="hay-widget-send">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            </form>
          </div>
        </div>
      `;

      document.body.appendChild(widget);
      this.widget = widget;
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
      const button = document.getElementById('hay-widget-button');
      const closeBtn = document.getElementById('hay-widget-close');
      const form = document.getElementById('hay-message-form');
      const input = document.getElementById('hay-message-input');

      button.addEventListener('click', () => this.toggle());
      closeBtn.addEventListener('click', () => this.close());
      
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = input.value.trim();
        if (message) {
          this.sendMessage(message);
          input.value = '';
        }
      });

      // Typing indicator
      let typingTimer;
      input.addEventListener('input', () => {
        clearTimeout(typingTimer);
        this.sendTypingIndicator(true);
        typingTimer = setTimeout(() => {
          this.sendTypingIndicator(false);
        }, 1000);
      });
    }

    /**
     * Connect to WebSocket server
     */
    connectWebSocket() {
      const wsUrl = this.config.websocketUrl || this.config.baseUrl.replace('http', 'ws') + '/ws';
      
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('Connected to chat server');
        this.reconnectAttempts = 0;
        
        // Send identification
        this.ws.send(JSON.stringify({
          type: 'identify',
          customerId: this.customerId,
          conversationId: this.conversationId,
          metadata: {
            url: window.location.href,
            referrer: document.referrer,
            userAgent: navigator.userAgent,
          }
        }));
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleServerMessage(data);
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      this.ws.onclose = () => {
        console.log('Disconnected from chat server');
        this.handleReconnect();
      };
    }

    /**
     * Handle reconnection with exponential backoff
     */
    handleReconnect() {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        
        setTimeout(() => {
          this.connectWebSocket();
        }, delay);
      } else {
        console.error('Max reconnection attempts reached');
        this.showConnectionError();
      }
    }

    /**
     * Handle messages from server
     */
    handleServerMessage(data) {
      switch (data.type) {
        case 'identified':
          if (data.conversationId) {
            this.saveConversationId(data.conversationId);
          }
          break;
          
        case 'message':
          this.addMessage(data.data.text, 'agent', data.data);
          this.playNotificationSound();
          this.updateUnreadBadge();
          break;
          
        case 'typing':
          this.showTypingIndicator(data.isTyping);
          break;
          
        case 'history':
          this.loadMessages(data.messages);
          break;
          
        default:
          console.log('Unknown message type:', data.type);
      }
    }

    /**
     * Load conversation history
     */
    loadConversationHistory() {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'load_history',
          conversationId: this.conversationId,
        }));
      }
    }

    /**
     * Send message
     */
    sendMessage(text) {
      // Add message to UI immediately
      this.addMessage(text, 'user');

      // Send via WebSocket
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'message',
          conversationId: this.conversationId,
          customerId: this.customerId,
          text: text,
          timestamp: new Date().toISOString(),
        }));
      } else {
        // Fallback to HTTP
        this.sendMessageHTTP(text);
      }
    }

    /**
     * Send message via HTTP (fallback)
     */
    async sendMessageHTTP(text) {
      try {
        const response = await fetch(`${this.config.baseUrl}/plugins/webhooks/hay-plugin-webchat/message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-organization-id': this.config.organizationId,
          },
          body: JSON.stringify({
            conversationId: this.conversationId,
            userId: this.customerId,
            text: text,
          }),
        });

        const data = await response.json();
        if (data.conversationId && !this.conversationId) {
          this.saveConversationId(data.conversationId);
        }
      } catch (error) {
        console.error('Failed to send message via HTTP:', error);
        this.showError('Failed to send message. Please try again.');
      }
    }

    /**
     * Send typing indicator
     */
    sendTypingIndicator(isTyping) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'typing',
          conversationId: this.conversationId,
          isTyping: isTyping,
        }));
      }
    }

    /**
     * Add message to UI
     */
    addMessage(text, sender, metadata = {}) {
      const container = document.getElementById('hay-messages-container');
      const message = document.createElement('div');
      message.className = `hay-message hay-message-${sender}`;
      
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      message.innerHTML = `
        <div class="hay-message-bubble">
          <div class="hay-message-text">${this.escapeHtml(text)}</div>
          <div class="hay-message-time">${time}</div>
        </div>
      `;
      
      container.appendChild(message);
      this.scrollToBottom();
      
      // Store message
      this.messages.push({
        text,
        sender,
        timestamp: new Date(),
        metadata,
      });
    }

    /**
     * Show typing indicator
     */
    showTypingIndicator(show) {
      const existing = document.getElementById('hay-typing-indicator');
      
      if (show && !existing) {
        const container = document.getElementById('hay-messages-container');
        const indicator = document.createElement('div');
        indicator.id = 'hay-typing-indicator';
        indicator.className = 'hay-typing-indicator';
        indicator.innerHTML = `
          <div class="hay-typing-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
        `;
        container.appendChild(indicator);
        this.scrollToBottom();
      } else if (!show && existing) {
        existing.remove();
      }
    }

    /**
     * Toggle widget
     */
    toggle() {
      this.isOpen ? this.close() : this.open();
    }

    /**
     * Open widget
     */
    open() {
      const window = document.getElementById('hay-widget-window');
      window.style.display = 'flex';
      this.isOpen = true;
      this.clearUnreadBadge();
      
      // Focus input
      setTimeout(() => {
        document.getElementById('hay-message-input').focus();
      }, 100);

      // Show greeting if configured
      if (this.config.showGreeting && this.messages.length === 0) {
        setTimeout(() => {
          this.addMessage(this.config.greetingMessage, 'agent', { isGreeting: true });
        }, 500);
      }
    }

    /**
     * Close widget
     */
    close() {
      const window = document.getElementById('hay-widget-window');
      window.style.display = 'none';
      this.isOpen = false;
    }

    /**
     * Update unread badge
     */
    updateUnreadBadge() {
      if (!this.isOpen) {
        const badge = document.getElementById('hay-unread-badge');
        const count = parseInt(badge.textContent) || 0;
        badge.textContent = count + 1;
        badge.style.display = 'flex';
      }
    }

    /**
     * Clear unread badge
     */
    clearUnreadBadge() {
      const badge = document.getElementById('hay-unread-badge');
      badge.textContent = '0';
      badge.style.display = 'none';
    }

    /**
     * Scroll messages to bottom
     */
    scrollToBottom() {
      const container = document.getElementById('hay-messages');
      container.scrollTop = container.scrollHeight;
    }

    /**
     * Play notification sound
     */
    playNotificationSound() {
      // Create and play a simple notification sound
      const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOWqzn7blmFAU7k9n1unEiBC13yO/eizEIHWq+8+OWT');
      audio.volume = 0.5;
      audio.play().catch(() => {});
    }

    /**
     * Show connection error
     */
    showConnectionError() {
      this.addMessage('Connection lost. Please refresh the page if the problem persists.', 'system');
    }

    /**
     * Show error message
     */
    showError(message) {
      this.addMessage(message, 'system');
    }

    /**
     * Escape HTML
     */
    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    /**
     * Load messages array
     */
    loadMessages(messages) {
      messages.forEach(msg => {
        this.addMessage(msg.text, msg.sender, msg.metadata);
      });
    }
  }

  // Initialize widget when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.HayWebchat = new HayWebchat(config);
      window.HayWebchat.init();
    });
  } else {
    window.HayWebchat = new HayWebchat(config);
    window.HayWebchat.init();
  }

})(window, document);