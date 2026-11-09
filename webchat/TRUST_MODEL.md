# Webchat widget trust model

What the widget can and cannot promise, for anyone embedding it or changing it.

## The host page is fully trusted

`widget.js` runs as a script in the embedding page, in that page's origin. There is no frame or other
boundary between the two. Any script on the page, including tag managers and third-party code the
site owner added, can read the conversation, call `window.HayChat`, and use the widget's stored keys
to send messages as the visitor. Embed the widget only on pages whose scripts you already trust with
your customers' conversations.

## Allowed domains are a browser control

`allowedDomains` (Settings → Webchat) decides which sites may start a conversation for an
organization. It relies on the `Origin` a browser sends, so it stops other websites from embedding
your widget. It does not stop a non-browser client, which can send any `Origin`. Rate limits and the
challenge flow cover those clients. Use real hostnames here: `*` lets every site start conversations.

## Who the visitor is

A visitor is anonymous unless the site says otherwise.

- Each conversation is bound to a browser keypair (DPoP). The private key cannot be exported, so the
  conversation cannot be continued from elsewhere by copying a token, but scripts on the page can
  still use the key while they run there.
- `customerExternalId` identifies a customer only when it comes with `customerExternalIdSignature`,
  computed on the site's server with the organization's identity secret. The secret must never reach
  the browser.

## Message content is untrusted

Replies can quote customers, documents and tool results. The widget escapes all HTML and allows only
a small markdown subset with http(s) URLs (`src/utils/markdown.ts`). Any change there needs a case in
`src/utils/__tests__/markdown.spec.ts`.

## Page tools run with the page's privileges

Tools registered with `window.HayChat.tools` (see `PAGE_TOOLS.md`) run in the visitor's browser when
the AI asks for them, and the AI's input can be influenced by what a customer or a document says.
Treat tool input as untrusted, and don't register tools that do something the visitor couldn't
reasonably approve.
