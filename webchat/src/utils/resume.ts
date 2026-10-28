/**
 * Query parameter on the link in a follow-up email (D5-9, server
 * web-follow-up.service.ts). It names the conversation to reopen; the widget
 * can only resume it in the browser that holds the conversation's key.
 */
export const RESUME_PARAM = "hay_conversation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The conversation id from the page URL, if a follow-up email link opened it. */
export function resumeConversationId(href: string = window.location.href): string | null {
  try {
    const id = new URL(href).searchParams.get(RESUME_PARAM);
    return id && UUID.test(id) ? id : null;
  } catch {
    return null;
  }
}
