# Lessons

## Dashboard `Switch` binds `modelValue`, not `checked`

- Failure mode: `<Switch v-model:checked>` / `:checked` + `@update:checked` compile and render, but the switch never changes (PreChatFormBuilder could never be turned on).
- Detection signal: a switch that does not move when clicked; no error anywhere.
- Prevention rule: use `v-model` (or `:model-value` / `@update:model-value`) on `Switch`, or `<Input type="switch">`.

## Two-way watchers between a child draft and `v-model`

- Failure mode: a child that copies `modelValue` into a draft on change and emits a parsed copy of the draft on change loops forever ("Maximum recursive updates") once the parent echoes the value back as a new object.
- Detection signal: page freezes or Vue's recursive-update error after the first edit.
- Prevention rule: compare by value before copying in or emitting out.
