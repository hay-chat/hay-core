import type { PromptVariableType } from "../types/prompt.types";

export class VariableEngine {
  /**
   * Replace variables in prompt content
   */
  static render(template: string, variables: Record<string, PromptVariableType>): string {
    let result = template;

    // Process conditionals first
    result = this.processConditionals(result, variables);

    // Process loops
    result = this.processLoops(result, variables);

    // Replace simple variables with default values support
    result = this.replaceVariables(result, variables);

    // Clean up any remaining unmatched variables
    result = this.cleanUnmatchedVariables(result);

    return result;
  }

  /**
   * Process conditional blocks: {{#if variable}}...{{/if}}
   */
  private static processConditionals(
    template: string,
    variables: Record<string, PromptVariableType>
  ): string {
    const conditionalPattern = /\{\{#if\s+([^}]+?)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;

    return template.replace(conditionalPattern, (_match, condition, truthyBlock, falsyBlock = "") => {
      const conditionValue = this.evaluateCondition(condition.trim(), variables);
      
      if (conditionValue) {
        return this.render(truthyBlock, variables);
      } else if (falsyBlock) {
        return this.render(falsyBlock, variables);
      }
      
      return "";
    });
  }

  /**
   * Process loop blocks: {{#each array}}...{{/each}}
   */
  private static processLoops(
    template: string,
    variables: Record<string, PromptVariableType>
  ): string {
    const loopPattern = /\{\{#each\s+([^}]+?)\}\}([\s\S]*?)\{\{\/each\}\}/g;

    return template.replace(loopPattern, (_match, arrayPath, block) => {
      const array = this.getNestedValue(variables, arrayPath.trim());

      if (Array.isArray(array)) {
        return array
          .map((item, index) => {
            const itemVariables = {
              ...variables,
              item,
              index,
              first: index === 0,
              last: index === array.length - 1,
            };
            return this.render(block, itemVariables);
          })
          .join("");
      }

      return "";
    });
  }

  /**
   * Replace simple variables, supporting default values
   */
  private static replaceVariables(
    template: string,
    variables: Record<string, PromptVariableType>
  ): string {
    // Match {{variable}}, {{variable|default:"value"}}, or {{object.property}}
    const variablePattern = /\{\{([^}#/]+?)\}\}/g;

    return template.replace(variablePattern, (_match, varExpression) => {
      const trimmed = varExpression.trim();
      
      // Check for default value syntax
      const pipeIndex = trimmed.indexOf("|");
      let varPath: string;
      let defaultValue = "";

      if (pipeIndex !== -1) {
        varPath = trimmed.substring(0, pipeIndex).trim();
        const defaultMatch = trimmed.substring(pipeIndex + 1).match(/default:\s*"([^"]*)"/);
        if (defaultMatch) {
          defaultValue = defaultMatch[1];
        }
      } else {
        varPath = trimmed;
      }

      const value = this.getNestedValue(variables, varPath);
      
      if (value !== undefined && value !== null) {
        return this.formatValue(value);
      }
      
      return defaultValue;
    });
  }

  /**
   * Evaluate a condition for {{#if}} blocks
   */
  private static evaluateCondition(
    condition: string,
    variables: Record<string, PromptVariableType>
  ): boolean {
    // Handle negation ({{#if not variable}})
    if (condition.startsWith("not ")) {
      const varPath = condition.substring(4).trim();
      return !this.isTruthy(this.getNestedValue(variables, varPath));
    }

    // Handle equality ({{#if variable eq "value"}})
    const eqMatch = condition.match(/^(.+?)\s+eq\s+"([^"]*)"$/);
    if (eqMatch) {
      const [, varPath, compareValue] = eqMatch;
      const value = this.getNestedValue(variables, varPath.trim());
      return String(value) === compareValue;
    }

    // Simple truthiness check
    return this.isTruthy(this.getNestedValue(variables, condition));
  }

  /**
   * Check if a value is truthy
   */
  private static isTruthy(value: PromptVariableType | undefined): boolean {
    if (value === undefined || value === null || value === false || value === 0 || value === "") {
      return false;
    }
    
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    
    if (typeof value === "object") {
      return Object.keys(value).length > 0;
    }
    
    return true;
  }

  /**
   * Get nested value from object using dot notation
   */
  private static getNestedValue(
    obj: Record<string, PromptVariableType>,
    path: string
  ): PromptVariableType | undefined {
    const keys = path.split(".");
    let current: any = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[key];
    }

    return current as PromptVariableType | undefined;
  }

  /**
   * Format value for output
   */
  private static formatValue(value: PromptVariableType): string {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    if (Array.isArray(value)) {
      return value.join(", ");
    }

    if (typeof value === "object") {
      // For objects, try to return a meaningful string representation
      if (value.toString && value.toString !== Object.prototype.toString) {
        return value.toString();
      }
      return JSON.stringify(value, null, 2);
    }

    return String(value);
  }

  /**
   * Clean up unmatched variables from the template
   */
  private static cleanUnmatchedVariables(template: string): string {
    // Remove any remaining {{variable}} patterns
    return template.replace(/\{\{[^}]*?\}\}/g, "");
  }
}