// 11:24
(function (window, document) {
  "use strict";

  // Widget configuration (injected by server)
  const config = window.HayChat?.config || __WIDGET_CONFIG__;

  // Storage keys
  const CONVERSATION_KEY = "hay-conversation-id";

  class HayWebchat {
    constructor(config) {
      this.config = config;
      this.isOpen = false;
      this.messages = [];
      this.conversationId = this.getConversationId();
      this.pollingInterval = null;
      this.isAgentTyping = false;
      this.isSending = false;
      this.cryptoAvailable = false;
      this.nonce = null;
      this.isConversationClosed = false;
    }

    /**
     * Get existing conversation ID from session storage
     */
    getConversationId() {
      return sessionStorage.getItem(CONVERSATION_KEY);
    }

    /**
     * Save conversation ID to session storage
     */
    saveConversationId(conversationId) {
      this.conversationId = conversationId;
      sessionStorage.setItem(CONVERSATION_KEY, conversationId);
    }

    /**
     * Clear conversation
     */
    clearConversation() {
      this.conversationId = null;
      sessionStorage.removeItem(CONVERSATION_KEY);
      this.messages = [];
      this.clearKeypair();
      this.isConversationClosed = false;
    }

    /**
     * Check if WebCrypto is available
     */
    isWebCryptoAvailable() {
      return (
        typeof window !== "undefined" &&
        window.crypto &&
        window.crypto.subtle &&
        typeof window.crypto.subtle.generateKey === "function"
      );
    }

    /**
     * Generate ECDSA P-256 keypair
     */
    async generateKeypair() {
      const keypair = await crypto.subtle.generateKey(
        {
          name: "ECDSA",
          namedCurve: "P-256",
        },
        true, // extractable
        ["sign", "verify"],
      );

      // Export public key as JWK
      const publicJwk = await crypto.subtle.exportKey("jwk", keypair.publicKey);

      return {
        privateKey: keypair.privateKey,
        publicKey: keypair.publicKey,
        publicJwk,
      };
    }

    /**
     * Store keypair in IndexedDB
     */
    async storeKeypair(conversationId, privateKey, publicKey, publicJwk) {
      if (!window.indexedDB) {
        console.warn("IndexedDB not available, using sessionStorage fallback");
        sessionStorage.setItem(`hay-keypair-${conversationId}`, JSON.stringify(publicJwk));
        return;
      }

      return new Promise((resolve, reject) => {
        const request = indexedDB.open("hay-dpop", 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(["keypairs"], "readwrite");
          const store = transaction.objectStore("keypairs");

          store.put({
            conversationId,
            privateKey,
            publicKey,
            publicJwk,
            createdAt: Date.now(),
          });

          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains("keypairs")) {
            const store = db.createObjectStore("keypairs", { keyPath: "conversationId" });
            store.createIndex("createdAt", "createdAt", { unique: false });
          }
        };
      });
    }

    /**
     * Get keypair from IndexedDB
     */
    async getKeypair(conversationId) {
      if (!window.indexedDB) {
        const stored = sessionStorage.getItem(`hay-keypair-${conversationId}`);
        return stored ? { publicJwk: JSON.parse(stored) } : null;
      }

      return new Promise((resolve, reject) => {
        const request = indexedDB.open("hay-dpop", 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(["keypairs"], "readonly");
          const store = transaction.objectStore("keypairs");
          const getRequest = store.get(conversationId);

          getRequest.onsuccess = () => {
            db.close();
            resolve(getRequest.result);
          };
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains("keypairs")) {
            const store = db.createObjectStore("keypairs", { keyPath: "conversationId" });
            store.createIndex("createdAt", "createdAt", { unique: false });
          }
        };
      });
    }

    /**
     * Clear keypair from storage
     */
    async clearKeypair() {
      if (!this.conversationId) return;

      if (!window.indexedDB) {
        sessionStorage.removeItem(`hay-keypair-${this.conversationId}`);
        return;
      }

      return new Promise((resolve, reject) => {
        const request = indexedDB.open("hay-dpop", 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(["keypairs"], "readwrite");
          const store = transaction.objectStore("keypairs");
          store.delete(this.conversationId);

          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      });
    }

    /**
     * Create DPoP proof
     */
    async createDPoPProof(privateKey, publicJwk, method, url, nonce, jti) {
      // Create header
      const header = {
        typ: "dpop+jwt",
        alg: "ES256",
        jwk: publicJwk,
      };

      // Create payload
      const payload = {
        jti: jti || this.generateJTI(),
        htm: method.toUpperCase(),
        htu: url,
        iat: Math.floor(Date.now() / 1000),
        nonce: nonce,
      };

      // Encode header and payload
      const encodedHeader = this.base64url(JSON.stringify(header));
      const encodedPayload = this.base64url(JSON.stringify(payload));
      const message = `${encodedHeader}.${encodedPayload}`;

      // Sign the message
      const encoder = new TextEncoder();
      const data = encoder.encode(message);
      const signature = await crypto.subtle.sign(
        {
          name: "ECDSA",
          hash: "SHA-256",
        },
        privateKey,
        data,
      );

      // Create the JWT
      const encodedSignature = this.base64url(signature);
      return `${message}.${encodedSignature}`;
    }

    /**
     * Base64url encode
     */
    base64url(input) {
      let output;
      if (typeof input === "string") {
        const encoder = new TextEncoder();
        output = btoa(String.fromCharCode(...encoder.encode(input)));
      } else if (input instanceof ArrayBuffer) {
        output = btoa(String.fromCharCode(...new Uint8Array(input)));
      } else {
        output = btoa(String.fromCharCode(...input));
      }
      return output.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    }

    /**
     * Generate JTI (JWT ID)
     */
    generateJTI() {
      return Date.now() + "-" + Math.random().toString(36).substring(2, 15);
    }

    /**
     * Initialize the widget
     */
    async init() {
      console.log("Initializing Hay Webchat widget...");

      // Always create the widget UI first
      this.createWidget();
      this.attachEventListeners();

      // Check WebCrypto availability
      this.cryptoAvailable = this.isWebCryptoAvailable();

      if (!this.cryptoAvailable) {
        console.error("WebCrypto API not available - DPoP authentication not possible");
        // Still allow the widget to show, but it will show an error when trying to start a conversation
        return;
      }

      // Check for existing conversation
      if (this.conversationId) {
        const keypair = await this.getKeypair(this.conversationId);
        if (keypair) {
          await this.loadConversationHistory();
          this.startPolling();
        } else {
          // Conversation exists but no keypair - clear it
          this.clearConversation();
        }
      }
    }

    /**
     * Create widget HTML
     */
    createWidget() {
      const position = this.config.position || "right";
      const theme = this.config.theme || "blue";

      // Create widget container
      const widget = document.createElement("div");
      widget.id = "hay-webchat-widget";
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
              <h3 class="hay-widget-title">${this.config.widgetTitle || "Chat with us"}</h3>
              <p class="hay-widget-subtitle">${this.config.widgetSubtitle || ""}</p>
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
                disabled
              />
              <button type="submit" class="hay-widget-send" disabled>
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
      const button = document.getElementById("hay-widget-button");
      const closeBtn = document.getElementById("hay-widget-close");
      const form = document.getElementById("hay-message-form");
      const input = document.getElementById("hay-message-input");

      if (!button) {
        console.error("Widget button not found");
        return;
      }

      button.addEventListener("click", () => {
        console.log("Widget button clicked");
        this.toggle();
      });

      if (closeBtn) {
        closeBtn.addEventListener("click", () => this.close());
      }

      if (form) {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          const message = input.value.trim();
          if (message && !this.isSending) {
            this.sendMessage(message);
            input.value = "";
          }
        });
      }
    }

    /**
     * Create conversation with DPoP
     */
    async createConversation() {
      try {
        // Generate new keypair
        const { privateKey, publicKey, publicJwk } = await this.generateKeypair();

        // Create conversation with public key
        const response = await fetch(`${this.config.baseUrl}/v1/webConversations.create`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            publicJwk,
            metadata: {
              organizationId: this.config.organizationId,
              source: "web-embed",
              url: window.location.href,
              referrer: document.referrer,
              userAgent: navigator.userAgent,
              timestamp: new Date().toISOString(),
            },
          }),
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.message || "Failed to create conversation");
        }

        const data = await response.json();
        const { id: conversationId, nonce } = data.result.data;

        // Store keypair and conversation ID
        await this.storeKeypair(conversationId, privateKey, publicKey, publicJwk);
        this.saveConversationId(conversationId);
        this.nonce = nonce;

        this.enableInput();
        this.startPolling();

        // Show greeting if configured
        if (this.config.showGreeting && this.config.greetingMessage) {
          this.addMessage(this.config.greetingMessage, "agent", { isGreeting: true });
        }

        return conversationId;
      } catch (error) {
        console.error("Failed to create conversation:", error);
        this.showError("Failed to start conversation. Please try again.");
        return null;
      }
    }

    /**
     * Load conversation history with DPoP
     */
    async loadConversationHistory(retryCount = 0) {
      if (!this.conversationId) return;

      try {
        const keypair = await this.getKeypair(this.conversationId);
        if (!keypair) {
          this.clearConversation();
          return;
        }

        // Create DPoP proof
        const method = "POST";
        const url = `${this.config.baseUrl}/v1/webConversations.getMessages`;
        const proof = await this.createDPoPProof(
          keypair.privateKey,
          keypair.publicJwk,
          method,
          url,
          this.nonce || "initial",
          this.generateJTI(),
        );

        const response = await fetch(url, {
          method,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            conversationId: this.conversationId,
            proof,
            method,
            url,
            limit: 50,
          }),
        });

        const data = await response.json();

        // Check if response is OK but contains nonce expiration error
        if (response.ok && data.result?.data?.error === "NONCE_EXPIRED" && retryCount < 1) {
          this.nonce = data.result.data.nonce;
          // Retry with new nonce
          return this.loadConversationHistory(retryCount + 1);
        }

        if (!response.ok) {
          // Conversation might not exist or auth failed
          this.clearConversation();
          return;
        }

        const { messages, nonce } = data.result.data;

        // Update nonce
        this.nonce = nonce;

        // Load messages
        if (messages && messages.length > 0) {
          this.messages = [];

          // Check if conversation is closed
          const hasClosureMessage = messages.some(msg =>
            msg.metadata && msg.metadata.isClosureMessage === true
          );
          if (hasClosureMessage) {
            this.isConversationClosed = true;
          }

          messages.forEach((msg) => {
            // Determine sender based on type and direction
            let sender = msg.type === "Customer" ? "user" : "agent";
            this.addMessage(msg.content, sender, msg, false);
          });
          this.scrollToBottom();
        }

        this.enableInput();
      } catch (error) {
        console.error("Failed to load conversation history:", error);
        this.clearConversation();
      }
    }

    /**
     * Poll for conversation updates with DPoP
     */
    async pollConversation(retryCount = 0) {
      if (!this.conversationId || !this.isOpen) return;

      try {
        const keypair = await this.getKeypair(this.conversationId);
        if (!keypair) return;

        // Create DPoP proof
        const method = "POST";
        const url = `${this.config.baseUrl}/v1/webConversations.getMessages`;
        const proof = await this.createDPoPProof(
          keypair.privateKey,
          keypair.publicJwk,
          method,
          url,
          this.nonce || "initial",
          this.generateJTI(),
        );

        const response = await fetch(url, {
          method,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            conversationId: this.conversationId,
            proof,
            method,
            url,
            limit: 50,
          }),
        });

        const data = await response.json();

        // Check if response is OK but contains nonce expiration error
        if (response.ok && data.result?.data?.error === "NONCE_EXPIRED" && retryCount < 1) {
          this.nonce = data.result.data.nonce;
          // Retry immediately with new nonce
          return this.pollConversation(retryCount + 1);
        }

        if (!response.ok) {
          return;
        }

        const { messages, nonce, typing } = data.result.data;

        // Update nonce
        this.nonce = nonce;

        // Check if conversation is closed by looking for closure messages
        const hasClosureMessage = messages.some(msg =>
          msg.metadata && msg.metadata.isClosureMessage === true
        );

        if (hasClosureMessage && !this.isConversationClosed) {
          this.isConversationClosed = true;
          console.log("Conversation has been closed");
        }

        // Update typing indicator based on server state
        if (typing && !this.isAgentTyping) {
          this.isAgentTyping = true;
          this.showTypingIndicator();
        } else if (!typing && this.isAgentTyping) {
          this.isAgentTyping = false;
          this.hideTypingIndicator();
        }

        // Check for new messages
        if (messages.length > this.messages.length) {
          // Get only new messages
          const newMessages = messages.slice(this.messages.length);

          newMessages.forEach((msg) => {
            // Determine sender based on type and direction
            let sender = msg.type === "Customer" ? "user" : "agent";
            this.addMessage(msg.content, sender, msg, true);

            // Check if this is a closure message
            if (msg.metadata && msg.metadata.isClosureMessage === true) {
              this.isConversationClosed = true;
            }
          });
        }
      } catch (error) {
        console.error("Failed to poll conversation:", error);
      }
    }

    /**
     * Start polling for updates
     */
    startPolling() {
      this.stopPolling();
      this.pollingInterval = setInterval(() => {
        this.pollConversation();
      }, 2000); // Poll every 2 seconds
    }

    /**
     * Stop polling
     */
    stopPolling() {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }
    }

    /**
     * Send message with DPoP
     */
    async sendMessage(text, retryCount = 0) {
      // Check if conversation is closed and we need to start a new one
      if (this.isConversationClosed && retryCount === 0) {
        console.log("Conversation was closed, starting new conversation...");

        // Clear the current messages from UI
        const container = document.getElementById("hay-messages-container");
        if (container) {
          container.innerHTML = '';
        }

        // Clear the conversation state
        this.clearConversation();

        // Create a new conversation
        const conversationId = await this.createConversation();
        if (!conversationId) return;

        // Continue sending the message with the new conversation
      } else if (!this.conversationId) {
        // Create conversation first if none exists
        const conversationId = await this.createConversation();
        if (!conversationId) return;
      }

      // Add message to UI immediately (only on first attempt)
      if (retryCount === 0) {
        this.addMessage(text, "user", {}, false);
        this.isSending = true;
        // Don't show typing indicator here - let the server tell us when it's processing
      }

      try {
        const keypair = await this.getKeypair(this.conversationId);
        if (!keypair) {
          throw new Error("No keypair found");
        }

        // Create DPoP proof
        const method = "POST";
        const url = `${this.config.baseUrl}/v1/webConversations.sendMessage`;
        const proof = await this.createDPoPProof(
          keypair.privateKey,
          keypair.publicJwk,
          method,
          url,
          this.nonce || "initial",
          this.generateJTI(),
        );

        const response = await fetch(url, {
          method,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            conversationId: this.conversationId,
            content: text,
            proof,
            method,
            url,
          }),
        });

        const data = await response.json();

        // Check if response is OK but contains nonce expiration error
        if (response.ok && data.result?.data?.error === "NONCE_EXPIRED" && retryCount < 1) {
          this.nonce = data.result.data.nonce;
          // Retry with new nonce
          return this.sendMessage(text, retryCount + 1);
        }

        if (!response.ok) {
          throw new Error("Failed to send message");
        }

        const { nonce } = data.result.data;

        // Update nonce
        this.nonce = nonce;

        // Message sent successfully, polling will pick up the response
      } catch (error) {
        console.error("Failed to send message:", error);
        this.showError("Failed to send message. Please try again.");
        // Remove the message that failed to send
        const container = document.getElementById("hay-messages-container");
        if (container.lastChild) {
          container.removeChild(container.lastChild);
          this.messages.pop();
        }
        this.hideTypingIndicator();
        this.isAgentTyping = false;
      } finally {
        this.isSending = false;
      }
    }

    /**
     * Enable input
     */
    enableInput() {
      const input = document.getElementById("hay-message-input");
      const button = document.querySelector(".hay-widget-send");
      if (input) input.disabled = false;
      if (button) button.disabled = false;
    }

    /**
     * Add message to UI
     */
    addMessage(text, sender, metadata = {}, playSound = true) {
      const container = document.getElementById("hay-messages-container");
      const message = document.createElement("div");

      // Check if this is a closure message
      const isClosureMessage = metadata.metadata && metadata.metadata.isClosureMessage === true;

      // Add appropriate classes
      let className = `hay-message hay-message-${sender}`;
      if (isClosureMessage) {
        className += ' hay-message-closure';
      }
      message.className = className;

      const time = metadata.createdAt
        ? new Date(metadata.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      // Add a closure indicator if this is a closure message
      const closureIndicator = isClosureMessage
        ? '<div class="hay-closure-indicator">🔒 Conversation Closed</div>'
        : '';

      message.innerHTML = `
        <div class="hay-message-bubble">
          ${closureIndicator}
          <div class="hay-message-text">${this.formatMessage(text)}</div>
          <div class="hay-message-time">${time}</div>
        </div>
      `;

      container.appendChild(message);
      this.scrollToBottom();

      // Store message
      this.messages.push({
        text,
        sender,
        timestamp: metadata.createdAt || new Date(),
        metadata,
      });

      // Play notification sound for agent messages
      if (sender === "agent" && playSound && this.isOpen) {
        this.playNotificationSound();
      }

      // Update unread badge
      if (sender === "agent" && !this.isOpen) {
        this.updateUnreadBadge();
      }
    }

    /**
     * Format message text (basic markdown and link detection)
     */
    formatMessage(text) {
      // Escape HTML first
      const div = document.createElement("div");
      div.textContent = text;
      let formatted = div.innerHTML;

      // Basic markdown parsing
      formatted = formatted
        // Bold
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        // Italic
        .replace(/\*(.*?)\*/g, "<em>$1</em>")
        // Code
        .replace(/`(.*?)`/g, "<code>$1</code>")
        // Line breaks
        .replace(/\n/g, "<br>");

      // Detect URLs and convert to clickable links
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      formatted = formatted.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener">$1</a>');

      return formatted;
    }

    /**
     * Show typing indicator
     */
    showTypingIndicator() {
      const existing = document.getElementById("hay-typing-indicator");

      if (!existing) {
        const container = document.getElementById("hay-messages-container");
        const indicator = document.createElement("div");
        indicator.id = "hay-typing-indicator";
        indicator.className = "hay-typing-indicator";
        indicator.innerHTML = `
          <div class="hay-typing-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
        `;
        container.appendChild(indicator);
        this.scrollToBottom();
      }
    }

    /**
     * Hide typing indicator
     */
    hideTypingIndicator() {
      const existing = document.getElementById("hay-typing-indicator");
      if (existing) {
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
      console.log("Opening widget...");
      const window = document.getElementById("hay-widget-window");
      if (!window) {
        console.error("Widget window not found");
        return;
      }

      window.style.display = "flex";
      this.isOpen = true;
      this.clearUnreadBadge();

      // Check if WebCrypto is available before trying to create conversation
      if (!this.cryptoAvailable) {
        this.showError(
          "Your browser does not support secure authentication. Please use a modern browser.",
        );
        this.enableInput(); // Enable input but it won't work
        return;
      }

      // Start conversation if not exists
      if (!this.conversationId) {
        console.log("No conversation ID, creating new conversation...");
        this.createConversation();
      } else {
        console.log("Existing conversation found:", this.conversationId);
        this.enableInput();
      }

      // Start polling
      this.startPolling();

      // Focus input
      setTimeout(() => {
        const input = document.getElementById("hay-message-input");
        if (input && !input.disabled) {
          input.focus();
        }
      }, 100);
    }

    /**
     * Close widget
     */
    close() {
      const window = document.getElementById("hay-widget-window");
      window.style.display = "none";
      this.isOpen = false;

      // Stop polling when closed
      this.stopPolling();
    }

    /**
     * Update unread badge
     */
    updateUnreadBadge() {
      if (!this.isOpen) {
        const badge = document.getElementById("hay-unread-badge");
        const count = parseInt(badge.textContent) || 0;
        badge.textContent = count + 1;
        badge.style.display = "flex";
      }
    }

    /**
     * Clear unread badge
     */
    clearUnreadBadge() {
      const badge = document.getElementById("hay-unread-badge");
      badge.textContent = "0";
      badge.style.display = "none";
    }

    /**
     * Scroll messages to bottom
     */
    scrollToBottom() {
      const container = document.getElementById("hay-messages");
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }

    /**
     * Play notification sound
     */
    playNotificationSound() {
      // Create and play a simple notification sound
      const audio = new Audio(
        "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOWqzn7blmFAU7k9n1unEiBC13yO/eizEIHWq+8+OWT",
      );
      audio.volume = 0.5;
      audio.play().catch(() => {});
    }

    /**
     * Show error message
     */
    showError(message) {
      this.addMessage(message, "system");
    }

    /**
     * Destroy widget
     */
    destroy() {
      this.stopPolling();
      if (this.widget) {
        this.widget.remove();
      }
    }
  }

  // Initialize widget when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      window.HayWebchat = new HayWebchat(config);
      window.HayWebchat.init();
    });
  } else {
    window.HayWebchat = new HayWebchat(config);
    window.HayWebchat.init();
  }
})(window, document);
