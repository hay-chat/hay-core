import type { API, InlineTool } from '@editorjs/editorjs';

export default class MCPMergeField implements InlineTool {
  static isInline = true;
  static title = 'MCPMergeField';
  static sanitize = {
    span: { 
      class: true, 
      'data-mcp-tool': true, 
      'data-plugin': true,
      'data-document-id': true,
      'data-document-name': true,
      contenteditable: true 
    }
  };

  constructor(_config: { api: API }) {
    // API is available but not needed for this implementation
    // since we handle everything programmatically
  }

  render() { 
    // No button in toolbar - we trigger this programmatically
    return document.createElement('div'); 
  }

  surround(range: Range) {
    // This is called programmatically when we want to insert a merge field
    const span = document.createElement('span');
    span.className = 'mcp-merge-field';
    span.contentEditable = 'false';
    span.dataset.mcpTool = 'placeholder';
    span.dataset.plugin = 'placeholder';
    span.textContent = '#placeholder';
    
    range.deleteContents();
    range.insertNode(span);
    range.collapse(false);
  }

  checkState() { 
    return false; 
  }

  // Custom method to insert a specific MCP tool
  insertMCPTool(toolId: string, toolName: string, pluginName: string) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    
    const range = selection.getRangeAt(0);
    const span = document.createElement('span');
    span.className = 'mcp-merge-field';
    span.contentEditable = 'false';
    span.dataset.mcpTool = toolId;
    span.dataset.plugin = pluginName;
    span.textContent = `#${toolName}`;
    
    range.deleteContents();
    range.insertNode(span);
    
    // Move cursor after the inserted span
    const newRange = document.createRange();
    newRange.setStartAfter(span);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);
  }
}