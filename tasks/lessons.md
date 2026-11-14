# Lessons

## Dashboard `Switch` binds `modelValue`, not `checked`

- Failure mode: `<Switch v-model:checked>` / `:checked` + `@update:checked` compile and render, but the switch never changes (PreChatFormBuilder could never be turned on).
- Detection signal: a switch that does not move when clicked; no error anywhere.
- Prevention rule: use `v-model` (or `:model-value` / `@update:model-value`) on `Switch`, or `<Input type="switch">`.

## Two-way watchers between a child draft and `v-model`

- Failure mode: a child that copies `modelValue` into a draft on change and emits a parsed copy of the draft on change loops forever ("Maximum recursive updates") once the parent echoes the value back as a new object.
- Detection signal: page freezes or Vue's recursive-update error after the first edit.
- Prevention rule: compare by value before copying in or emitting out.

## `srcdoc` iframes inherit the dashboard's CSP

- Failure mode: the webchat preview built its `srcdoc` with an inline `<script>` holding the config. In production the dashboard CSP (`script-src 'self' <hashes>`) is inherited by the frame, so the script was blocked; widget.js booted with no config (no preview mode, default settings, phone layout at 440px) and ignored every edit. Dev has no CSP, so it looked fine locally.
- Detection signal: "Executing inline script violates ... Content Security Policy" in the frame's console; preview works in dev but not in prod.
- Prevention rule: never put executable inline script in a `srcdoc`; pass data as a `<script type="application/json">` block. Test frames under the prod CSP (`dashboard/server/utils/security-headers.ts`).

## Parsing tenant content on the request thread

- Failure mode: help center article pages ran `marked` synchronously per request. A 40 KB crafted document took 11 s to parse, so one tenant could freeze the API for everyone by requesting its own article.
- Detection signal: an independent review timed the parser on adversarial input; tests with ordinary content were all fast.
- Prevention rule: any parser fed tenant content on a public path runs in a worker with a time limit (`processors/run-worker.ts`) and its output is cached by document version.

## `req.hostname` follows X-Forwarded-Host

- Failure mode: tenant selection used `req.hostname`. With `trust proxy` set, Express prefers `X-Forwarded-Host`, which many proxies pass through from the client, so a caller could choose which tenant (or the API) answered on any host.
- Detection signal: a request with a forged `X-Forwarded-Host` is answered by another tenant.
- Prevention rule: route by `req.headers.host` when the hostname decides tenancy or the security boundary.

## `repository.save(entity)` after a slow await writes stale columns back

- Failure mode: the domain check loaded a help center, awaited DNS for seconds, then saved the whole entity, which could restore `is_published` or a removed domain changed meanwhile.
- Detection signal: a setting changed during a domain check reverts after the check finishes.
- Prevention rule: after any slow await, write with `update(where, { only the columns this step owns })` and put the value that was checked in the `where`.
