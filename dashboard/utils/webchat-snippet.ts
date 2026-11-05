export interface WebchatSnippetInput {
  organizationId: string;
  baseUrl: string;
  widgetTitle: string;
  widgetSubtitle: string;
  position: string;
  theme: string;
  /** With Web Chat off there is no greeting to show, so the snippet leaves it out. */
  isEnabled: boolean;
  showGreeting: boolean;
  greetingMessage: string;
}

/**
 * A single-quoted JavaScript string literal. Settings text is free-form, so quotes, backslashes,
 * line breaks and `<` (which could close the surrounding script tag) are escaped.
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

/** The snippet that adds the chat widget to a customer's site. */
export function buildWebchatSnippet(input: WebchatSnippetInput): string {
  const greetingConfig = input.isEnabled
    ? `,
    showGreeting: ${input.showGreeting},
    greetingMessage: ${jsString(input.greetingMessage)}`
    : "";
  return `<${"script"}>
  window.HayChat = window.HayChat || {};
  window.HayChat.config = {
    organizationId: ${jsString(input.organizationId)},
    baseUrl: ${jsString(input.baseUrl)},
    widgetTitle: ${jsString(input.widgetTitle)},
    widgetSubtitle: ${jsString(input.widgetSubtitle)},
    position: ${jsString(input.position)},
    theme: ${jsString(input.theme)}${greetingConfig}
  };
</${"script"}>
<${"script"} src="${input.baseUrl}/v1/webchat/widget.js" async></${"script"}>`;
}
