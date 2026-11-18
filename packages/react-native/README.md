# @hay-chat/react-native

The Hay chat for React Native and Expo apps. It shows the same chat your website has (same
assistant, settings, languages, forms, attachments and human handoff) inside your app.

## Install

```bash
npm install @hay-chat/react-native react-native-webview
```

With Expo, use `npx expo install react-native-webview` for the second package. It works in Expo Go
and in development builds; no native code of ours is involved.

## Use

```tsx
import { HayChat } from "@hay-chat/react-native";

export function SupportScreen({ navigation }) {
  return (
    <HayChat
      organizationId="YOUR_ORGANIZATION_ID"
      baseUrl="YOUR_HAY_API_URL"
      origin="https://shop.example.com"
      onClose={() => navigation.goBack()}
    />
  );
}
```

`organizationId` and `baseUrl` are the two values in the snippet under Settings > Webchat > Install.
`origin` is one of the websites that page allows (your own site, if you listed none): the chat runs
as if it were on that site, so the same allowed-websites setting covers your app.

The chat fills the view you put it in: a screen, a modal, a bottom sheet. Give it the safe area and
keyboard handling you give your other screens.

### Signed-in customers

```tsx
<HayChat ... customer={{ externalId: user.id, signature: user.haySignature }} />
```

`signature` is the hex HMAC-SHA256 of `externalId`, keyed with the identity secret from Settings >
Webchat > Install. Compute it on your server and send it to the app with the rest of the user's
profile. Never put the secret in the app: anything shipped in an app can be read out of it.
Without a signature the visitor is anonymous.

### Unread badge

Keep the chat mounted and hide it instead of unmounting it, and replies that arrive while it is
hidden are counted:

```tsx
<HayChat ... visible={isChatOpen} onClose={() => setChatOpen(false)} onUnreadChange={setUnread} />
```

This works while your app is running. There are no push notifications yet, so a reply that
arrives after the app is closed shows the next time the chat is opened.

### Props

| Prop | |
| --- | --- |
| `organizationId`, `baseUrl`, `origin` | Required, see above. |
| `customer` | `{ externalId, signature }` for a signed-in customer. |
| `context` | Non-sensitive facts for the assistant (plan, current screen, cart). |
| `locale` | The chat's language, e.g. `"pt-br"`. Defaults to the device's. |
| `brandColor`, `themeMode` | Override the colour and light/dark theme from your settings. |
| `consent` | `"strict"` keeps conversations out of device storage until you allow it. |
| `visible` | `false` hides the chat but keeps it connected. |
| `onReady`, `onClose`, `onUnreadChange` | The chat is ready, was closed by the visitor, or has unread replies. |
| `onConversationStarted` | Called with `{ id }` on the visitor's first message. Return a promise to hold that message (up to 15 s) while your server attaches data with `@hay/server-sdk`. |

Changing `customer`, `context`, `locale` or the appearance props reloads the chat.

## What it does not do yet

- Push notifications for replies while the app is closed.
- Page tools (`window.HayChat.registerTool`), which let the assistant act on a web page.
- Native iOS (Swift) and Android (Kotlin) packages.

## Publishing (maintainers)

1. First release, by hand: `npm login`, then `npm publish --access public` in this folder. The
   `@hay-chat` organization must exist on npmjs.com and your account must be a member.
2. On npmjs.com, open the package's settings and add a trusted publisher: repository
   `hay-chat/hay-core`, workflow `publish-react-native.yml`.
3. Later releases: bump `version` in `package.json`, merge, then push a tag named
   `react-native-v<version>`. The workflow publishes it.
