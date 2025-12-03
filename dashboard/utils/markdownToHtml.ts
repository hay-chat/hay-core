export function markdownToHtml(markdown: string): string {
  // Basic markdown to HTML conversion
  let html = markdown;

  // Escape HTML entities first (for security)
  html = html.replace(/&/g, "&amp;");
  html = html.replace(/</g, "&lt;");
  html = html.replace(/>/g, "&gt;");

  // Convert code blocks (must come before line breaks)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

  // Convert inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Convert headers (must come before line breaks)
  html = html.replace(/^#### (.*$)/gim, "<h4>$1</h4>");
  html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
  html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
  html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

  // Convert bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Convert italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Convert strikethrough
  html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");

  // Convert links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Convert horizontal rules
  html = html.replace(/^---$/gim, "<hr>");
  html = html.replace(/^\*\*\*$/gim, "<hr>");

  // Convert unordered lists (simple version)
  html = html.replace(/^\s*[-*]\s+(.*)$/gim, "<li>$1</li>");

  // Convert ordered lists (simple version)
  html = html.replace(/^\s*\d+\.\s+(.*)$/gim, "<li>$1</li>");

  // Wrap consecutive list items
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
    return "<ul>" + match + "</ul>";
  });

  // Convert blockquotes
  html = html.replace(/^&gt;\s*(.*)$/gim, "<blockquote>$1</blockquote>");

  // Convert line breaks (for remaining newlines)
  html = html.replace(/\n\n/g, "</p><p>");
  html = html.replace(/\n/g, "<br>");

  // Wrap in paragraph if not already wrapped
  if (!html.startsWith("<")) {
    html = "<p>" + html + "</p>";
  }

  return html;
}
