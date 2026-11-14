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
