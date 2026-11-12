export interface WebchatSnippetInput {
  organizationId: string;
  baseUrl: string;
}

/**
 * A single-quoted JavaScript string literal. Values are escaped so quotes, backslashes,
 * line breaks and `<` (which could close the surrounding script tag) stay inside the string.
 */
export function jsString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `'${escaped}'`;
}

/**
 * The snippet that adds the chat widget to a customer's site. It carries only what the widget
 * needs to find its organization: everything else (title, position, greeting, colours) comes
 * from the saved settings, so changes in the dashboard reach sites without re-pasting the code.
 */
export function buildWebchatSnippet(input: WebchatSnippetInput): string {
  return `<${"script"}>
  window.HayChat = window.HayChat || {};
  window.HayChat.config = {
    organizationId: ${jsString(input.organizationId)},
    baseUrl: ${jsString(input.baseUrl)}
  };
</${"script"}>
<${"script"} src="${input.baseUrl}/v1/webchat/widget.js" async></${"script"}>`;
}
