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

  // Convert horizontal rules (must come before bold/italic to avoid * * * being eaten)
  html = html.replace(/^---$/gim, "<hr>");
  html = html.replace(/^\*\*\*$/gim, "<hr>");
  html = html.replace(/^\* \* \*$/gim, "<hr>");
  html = html.replace(/^___$/gim, "<hr>");

  // Convert bold (* and _ variants, double must come before single)
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // Convert italic (* and _ variants)
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/(?<!\w)_(.+?)_(?!\w)/g, "<em>$1</em>");

  // Convert strikethrough
  html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");

  // Convert images (must come before links since ![alt](url) would match [alt](url))
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, src) => {
    // Fix protocol-relative URLs (//example.com → https://example.com)
    const fixedSrc = src.startsWith("//") ? `https:${src}` : src;
    return `<img src="${fixedSrc}" alt="${alt}" loading="lazy" style="max-width: 100%; height: auto; border-radius: 0.375rem; margin: 0.5rem 0;" />`;
  });

  // Convert links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );

  // Convert unordered lists (simple version)
  html = html.replace(/^\s*[-*]\s+(.*)$/gim, "<li>$1</li>");

  // Convert ordered lists (simple version)
  html = html.replace(/^\s*\d+\.\s+(.*)$/gim, "<li>$1</li>");

  // Wrap consecutive list items and strip newlines between tags
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
    return "<ul>" + match.replace(/\n/g, "") + "</ul>";
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
