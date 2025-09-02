export function markdownToHtml(markdown: string): string {
  // Basic markdown to HTML conversion
  let html = markdown
  
  // Convert headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>')
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>')
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>')
  
  // Convert bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  
  // Convert italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  
  // Convert links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  
  // Convert line breaks
  html = html.replace(/\n/g, '<br>')
  
  return html
}