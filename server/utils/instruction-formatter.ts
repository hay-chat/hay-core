interface InstructionItem {
  id: string;
  level: number;
  instructions: string;
}

interface ParsedReference {
  type: 'action' | 'document';
  content: string;
  fullMatch: string;
}

interface InstructionAnalysis {
  formattedText: string;
  actions: string[];
  documents: string[];
}

/**
 * Parses references from instruction text
 * 
 * @param text - Text to parse for [action] and [document] references
 * @returns Array of parsed references
 */
function parseReferences(text: string): ParsedReference[] {
  const references: ParsedReference[] = [];
  
  // Match [action](content) and [document](content) patterns
  const referencePattern = /\[(action|document)\]\(([^)]+)\)/g;
  let match;
  
  while ((match = referencePattern.exec(text)) !== null) {
    references.push({
      type: match[1] as 'action' | 'document',
      content: match[2],
      fullMatch: match[0]
    });
  }
  
  return references;
}

/**
 * Converts JSON instructions array to formatted text with extracted references
 * 
 * @param instructionsJson - Array of instruction objects with id, level, and instructions
 * @returns Analysis object with formatted text and extracted references
 */
export function analyzeInstructions(instructionsJson: InstructionItem[]): InstructionAnalysis {
  if (!Array.isArray(instructionsJson) || instructionsJson.length === 0) {
    return {
      formattedText: '',
      actions: [],
      documents: []
    };
  }

  const lines: string[] = [];
  const levelCounters: number[] = [0]; // Track counters for each level
  const allActions: Set<string> = new Set();
  const allDocuments: Set<string> = new Set();
  
  for (const item of instructionsJson) {
    const level = Math.max(0, item.level); // Ensure non-negative level
    
    // Parse references from this instruction
    const references = parseReferences(item.instructions);
    references.forEach(ref => {
      if (ref.type === 'action') {
        allActions.add(ref.content);
      } else if (ref.type === 'document') {
        allDocuments.add(ref.content);
      }
    });
    
    // Extend counters array if needed
    while (levelCounters.length <= level) {
      levelCounters.push(0);
    }
    
    // Reset deeper level counters when moving up levels
    if (level < levelCounters.length - 1) {
      levelCounters.splice(level + 1);
    }
    
    // Increment counter for current level
    levelCounters[level]++;
    
    // Generate number prefix
    let numberPrefix: string;
    if (level === 0) {
      numberPrefix = `${levelCounters[level]}.`;
    } else {
      // For nested levels, use parent number + current number
      const parentNumber = levelCounters[0];
      const currentNumber = levelCounters[level];
      numberPrefix = `${parentNumber}.${currentNumber}.`;
    }
    
    // Add the formatted instruction
    const formattedLine = `${numberPrefix} ${item.instructions}`;
    lines.push(formattedLine);
  }
  
  return {
    formattedText: lines.join('\n\n'),
    actions: Array.from(allActions),
    documents: Array.from(allDocuments)
  };
}

/**
 * Converts JSON instructions array to formatted text (backward compatibility)
 * 
 * @param instructionsJson - Array of instruction objects with id, level, and instructions
 * @returns Formatted string with proper numbering and indentation
 */
export function convertInstructionsToText(instructionsJson: InstructionItem[]): string {
  const analysis = analyzeInstructions(instructionsJson);
  return analysis.formattedText;
}

/**
 * Checks if the input is a JSON instructions array
 * 
 * @param input - Input to check
 * @returns True if input is a valid instructions array
 */
export function isInstructionsJson(input: any): input is InstructionItem[] {
  return Array.isArray(input) && 
         input.length > 0 && 
         input.every(item => 
           typeof item === 'object' &&
           typeof item.id === 'string' &&
           typeof item.level === 'number' &&
           typeof item.instructions === 'string'
         );
}

/**
 * Formats instructions for display - handles both JSON and text formats
 * 
 * @param instructions - Instructions in JSON array or string format
 * @returns Formatted string ready for display
 */
export function formatInstructions(instructions: any): string {
  if (!instructions) {
    return 'No specific instructions provided.';
  }
  
  if (typeof instructions === 'string') {
    return instructions;
  }
  
  if (isInstructionsJson(instructions)) {
    return convertInstructionsToText(instructions);
  }
  
  // Fallback for other formats
  return JSON.stringify(instructions, null, 2);
}