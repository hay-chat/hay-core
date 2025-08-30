/**
 * Simple markdown to HTML converter
 * Supports:
 * - Paragraphs (newlines)
 * - Bold text (**text**)
 * - Ordered lists (1. 2. 3.)
 * - Unordered lists (- or *)
 * - Nested lists (with indentation)
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown) return '';

  // Split by double newlines to identify paragraphs and list blocks
  const blocks = markdown.split(/\n\n+/);
  
  const processedBlocks = blocks.map(block => {
    // Check if this block contains any list markers
    const hasOrderedList = /^\d+\.\s/m.test(block);
    const hasUnorderedList = /^[\-\*]\s/m.test(block);
    const hasIndentedList = /^[\s\t]+[\-\*\d]+[\.\s]/m.test(block);
    
    if (hasOrderedList || hasUnorderedList || hasIndentedList) {
      return processListBlock(block);
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
 * Process a block that contains lists (ordered, unordered, or nested)
 */
function processListBlock(block: string): string {
  const lines = block.split('\n').filter(line => line.trim());
  const result: string[] = [];
  const listStack: { type: 'ol' | 'ul', indent: number }[] = [];
  
  lines.forEach(line => {
    const indent = line.search(/\S/); // Count leading whitespace
    const trimmedLine = line.trim();
    
    // Determine list type and content
    let listType: 'ol' | 'ul' | null = null;
    let content = '';
    
    if (/^\d+\.\s/.test(trimmedLine)) {
      listType = 'ol';
      content = trimmedLine.replace(/^\d+\.\s/, '');
    } else if (/^[\-\*]\s/.test(trimmedLine)) {
      listType = 'ul';
      content = trimmedLine.replace(/^[\-\*]\s/, '');
    }
    
    if (listType) {
      // Close lists that are deeper than current indent
      while (listStack.length > 0 && listStack[listStack.length - 1].indent > indent) {
        const closingList = listStack.pop();
        result.push(`</${closingList?.type}>`);
      }
      
      // Check if we need to start a new list or continue existing one
      const currentList = listStack.length > 0 ? listStack[listStack.length - 1] : null;
      
      if (!currentList || currentList.indent < indent) {
        // Start a new nested list
        result.push(`<${listType}>`);
        listStack.push({ type: listType, indent });
      } else if (currentList.indent === indent && currentList.type !== listType) {
        // Switch list type at same level
        result.push(`</${currentList.type}>`);
        listStack.pop();
        result.push(`<${listType}>`);
        listStack.push({ type: listType, indent });
      }
      
      // Add the list item
      const processedContent = processBold(content);
      result.push(`<li>${processedContent}</li>`);
    }
  });
  
  // Close any remaining open lists
  while (listStack.length > 0) {
    const closingList = listStack.pop();
    result.push(`</${closingList?.type}>`);
  }
  
  return result.join('');
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
    },
    {
      input: '- Bullet one\n- Bullet **two**\n- Bullet three',
      expected: '<ul><li>Bullet one</li><li>Bullet <strong>two</strong></li><li>Bullet three</li></ul>'
    },
    {
      input: '1. First ordered item\n   - Nested bullet one\n   - Nested bullet two\n2. Second ordered item\n   - Another nested bullet\n3. Third ordered item',
      expected: '<ol><li>First ordered item</li><ul><li>Nested bullet one</li><li>Nested bullet two</li></ul><li>Second ordered item</li><ul><li>Another nested bullet</li></ul><li>Third ordered item</li></ol>'
    },
    {
      input: '1. Step one\n2. Step two with substeps:\n   - Substep A\n   - Substep B\n3. Step three',
      expected: '<ol><li>Step one</li><li>Step two with substeps:</li><ul><li>Substep A</li><li>Substep B</li></ul><li>Step three</li></ol>'
    },
    {
      input: '- Main bullet\n  1. Nested ordered one\n  2. Nested ordered two\n- Another main bullet',
      expected: '<ul><li>Main bullet</li><ol><li>Nested ordered one</li><li>Nested ordered two</li></ol><li>Another main bullet</li></ul>'
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