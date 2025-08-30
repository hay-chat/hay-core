/**
 * Simple markdown to HTML converter
 * Supports:
 * - Paragraphs (newlines)
 * - Bold text (**text**)
 * - Ordered lists (1. 2. 3.)
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown) return '';

  // Split by double newlines to identify paragraphs and list blocks
  const blocks = markdown.split(/\n\n+/);
  
  const processedBlocks = blocks.map(block => {
    // Check if this block is an ordered list
    const listMatch = block.match(/^\d+\.\s/);
    
    if (listMatch) {
      // Process ordered list
      const listItems = block.split(/\n/).filter(line => line.trim());
      const htmlItems = listItems.map(item => {
        // Remove the number and dot, process bold
        const content = item.replace(/^\d+\.\s/, '');
        const processedContent = processBold(content);
        return `<li>${processedContent}</li>`;
      }).join('');
      
      return `<ol>${htmlItems}</ol>`;
    } else {
      // Process as paragraph
      // Handle single newlines within paragraphs as line breaks
      const processedText = block
        .split('\n')
        .map(line => processBold(line.trim()))
        .filter(line => line)
        .join('<br>');
      
      return processedText ? `<p>${processedText}</p>` : '';
    }
  });

  return processedBlocks.filter(block => block).join('');
}

/**
 * Convert **text** to <strong>text</strong>
 */
function processBold(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

// Example usage and test cases
export function testMarkdownToHtml() {
  const examples = [
    {
      input: 'This is a **bold** text.',
      expected: '<p>This is a <strong>bold</strong> text.</p>'
    },
    {
      input: 'First line\nSecond line\n\nNew paragraph',
      expected: '<p>First line<br>Second line</p><p>New paragraph</p>'
    },
    {
      input: '1. First item\n2. Second **bold** item\n3. Third item',
      expected: '<ol><li>First item</li><li>Second <strong>bold</strong> item</li><li>Third item</li></ol>'
    },
    {
      input: 'Paragraph before\n\n1. List item one\n2. List item **two**\n\nParagraph after',
      expected: '<p>Paragraph before</p><ol><li>List item one</li><li>List item <strong>two</strong></li></ol><p>Paragraph after</p>'
    }
  ];

  examples.forEach(({ input, expected }, index) => {
    const result = markdownToHtml(input);
    console.log(`Test ${index + 1}:`);
    console.log('Input:', input);
    console.log('Output:', result);
    console.log('Expected:', expected);
    console.log('Pass:', result === expected);
    console.log('---');
  });
}