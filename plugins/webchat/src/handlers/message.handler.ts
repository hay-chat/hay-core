import { IncomingMessage, OutgoingMessage } from '../../../base';

export class MessageHandler {
  /**
   * Process incoming message
   */
  async processIncoming(message: IncomingMessage): Promise<void> {
    // Add any message preprocessing here
    // e.g., sanitization, validation, enrichment
    
    // Validate message
    if (!message.conversationId) {
      throw new Error('Conversation ID is required');
    }

    if (!message.userId) {
      throw new Error('User ID is required');
    }

    if (!message.text && (!message.attachments || message.attachments.length === 0)) {
      throw new Error('Message must contain text or attachments');
    }

    // Sanitize text content
    if (message.text) {
      message.text = this.sanitizeText(message.text);
    }

    // Validate attachments
    if (message.attachments) {
      for (const attachment of message.attachments) {
        this.validateAttachment(attachment);
      }
    }
  }

  /**
   * Process outgoing message
   */
  async processOutgoing(message: OutgoingMessage): Promise<OutgoingMessage> {
    // Add any message postprocessing here
    // e.g., formatting, link detection, markdown parsing

    if (message.text) {
      // Convert markdown to HTML for display
      message.text = this.parseMarkdown(message.text);
      
      // Detect and format links
      message.text = this.formatLinks(message.text);
    }

    return message;
  }

  /**
   * Sanitize text input
   */
  private sanitizeText(text: string): string {
    // Remove any potentially harmful content
    return text
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .trim();
  }

  /**
   * Validate attachment
   */
  private validateAttachment(attachment: any): void {
    const allowedTypes = ['image', 'video', 'audio', 'document'];
    
    if (!allowedTypes.includes(attachment.type)) {
      throw new Error(`Invalid attachment type: ${attachment.type}`);
    }

    if (!attachment.url) {
      throw new Error('Attachment URL is required');
    }

    // Check file size if provided
    if (attachment.size) {
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (attachment.size > maxSize) {
        throw new Error('Attachment size exceeds 10MB limit');
      }
    }
  }

  /**
   * Parse markdown to HTML
   */
  private parseMarkdown(text: string): string {
    // Basic markdown parsing
    return text
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Code
      .replace(/`(.*?)`/g, '<code>$1</code>')
      // Line breaks
      .replace(/\n/g, '<br>');
  }

  /**
   * Format links in text
   */
  private formatLinks(text: string): string {
    // Detect URLs and convert to clickable links
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }
}