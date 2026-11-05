---
name: Hay Dashboard
description: The operator's workspace for running and setting up AI customer support agents.
colors:
  primary: "#001df5"
  primary-foreground: "#ffffff"
  primary-50: "#e8f3ff"
  neutral-0: "#ffffff"
  neutral-50: "oklch(98.4% .003 247.858)"
  neutral-100: "oklch(96.8% .007 247.896)"
  neutral-200: "oklch(92.9% .013 255.508)"
  neutral-300: "oklch(86.9% .022 252.894)"
  neutral-400: "oklch(70.4% .04 256.788)"
  neutral-500: "oklch(55.4% .046 257.417)"
  neutral-700: "oklch(37.2% .044 257.287)"
  neutral-900: "oklch(20.8% .042 265.755)"
  destructive: "#c63c3c"
  destructive-foreground: "#ffffff"
  success-tint: "rgb(220, 252, 231)"
  success-ink: "rgb(22, 101, 52)"
  warning-tint: "rgb(254, 243, 199)"
  warning-ink: "rgb(120, 53, 15)"
  green-600: "#77951b"
  document-600: "rgb(178, 97, 5)"
  purple-600: "#9333ea"
typography:
  display:
    fontFamily: "Gabarito, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 500
    lineHeight: "2.25rem"
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Gabarito, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Gabarito, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.025em"
  section:
    fontFamily: "Gabarito, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: "1.5rem"
    letterSpacing: "-0.025em"
  callout:
    fontFamily: "Inter, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 500
    lineHeight: 1.5
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-strong:
    fontFamily: "Inter, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.5
  body-sm:
    fontFamily: "Inter, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: "1.25rem"
  caption:
    fontFamily: "Inter, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
  pill:
    fontFamily: "Inter, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.5
rounded:
  sm: "0.3rem"
  md: "0.4rem"
  lg: "0.5rem"
  xl: "0.75rem"
  2xl: "1rem"
  full: "9999px"
spacing:
  "1": "0.25rem"
  "1.5": "0.375rem"
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "5": "1.25rem"
  "6": "1.5rem"
  "8": "2rem"
  "14": "3.5rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "0.375rem"
    padding: "0.5rem 1rem"
    height: "2.5rem"
  button-primary-hover:
    backgroundColor: "color-mix(in srgb, #001df5 90%, transparent)"
  button-outline:
    backgroundColor: "{colors.neutral-0}"
    textColor: "{colors.neutral-700}"
    typography: "{typography.label}"
    rounded: "0.375rem"
    padding: "0.5rem 1rem"
    height: "2.5rem"
  button-outline-hover:
    backgroundColor: "{colors.neutral-100}"
  text-action:
    textColor: "{colors.primary}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 0.25rem"
  input:
    backgroundColor: "{colors.neutral-0}"
    textColor: "{colors.neutral-700}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
    height: "2.5rem"
  status-pill-ready:
    backgroundColor: "{colors.success-tint}"
    textColor: "{colors.success-ink}"
    typography: "{typography.pill}"
    rounded: "{rounded.full}"
    padding: "0.125rem 0.625rem"
  status-pill-missing:
    backgroundColor: "{colors.warning-tint}"
    textColor: "{colors.warning-ink}"
    typography: "{typography.pill}"
    rounded: "{rounded.full}"
    padding: "0.125rem 0.625rem"
  status-pill-needs-you:
    backgroundColor: "{colors.primary-50}"
    textColor: "{colors.primary}"
    typography: "{typography.pill}"
    rounded: "{rounded.full}"
    padding: "0.125rem 0.625rem"
  status-pill-in-progress:
    backgroundColor: "{colors.neutral-100}"
    textColor: "{colors.neutral-500}"
    typography: "{typography.pill}"
    rounded: "{rounded.full}"
    padding: "0.125rem 0.625rem"
  answer-tag:
    backgroundColor: "{colors.neutral-100}"
    textColor: "{colors.neutral-700}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "0.125rem 0.5rem"
  chip:
    backgroundColor: "{colors.neutral-0}"
    textColor: "{colors.neutral-900}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.full}"
    padding: "0.375rem 0.875rem"
  chip-selected:
    backgroundColor: "{colors.primary-50}"
    textColor: "{colors.primary}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0.375rem 0.875rem"
  choice-row:
    backgroundColor: "transparent"
    textColor: "{colors.neutral-900}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0.75rem"
  choice-row-selected:
    backgroundColor: "{colors.primary-50}"
    textColor: "{colors.neutral-900}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0.75rem"
  card:
    backgroundColor: "{colors.neutral-0}"
    textColor: "{colors.neutral-700}"
    rounded: "{rounded.lg}"
    padding: "1.5rem"
  next-step-band:
    backgroundColor: "{colors.primary-50}"
    textColor: "{colors.neutral-900}"
    typography: "{typography.callout}"
    rounded: "{rounded.lg}"
    padding: "0.75rem 1rem"
  next-step-band-done:
    backgroundColor: "{colors.neutral-50}"
    textColor: "{colors.neutral-900}"
    typography: "{typography.callout}"
    rounded: "{rounded.lg}"
    padding: "0.75rem 1rem"
  tool-panel:
    backgroundColor: "{colors.neutral-0}"
    textColor: "{colors.neutral-700}"
    rounded: "{rounded.xl}"
  nav-item:
    textColor: "{colors.neutral-700}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 0.75rem"
  nav-item-active:
    backgroundColor: "{colors.neutral-100}"
    textColor: "{colors.neutral-700}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 0.75rem"
---

<!-- Tokens and component facts are extracted from the shipped code. The North Star and the descriptive color names were proposed by the documenter from that evidence and have not been confirmed by the product owner. -->

# Design System: Hay Dashboard

## Overview

**Creative North Star: "The Plain Workbench"**

The Hay dashboard reads as a well-lit workbench: plain surfaces, one clearly marked action color, and everything labeled in ordinary words. Cards hold areas of work across most pages; where a person works through real entries, those entries become hairline-divided rows, each with an honest status and the one action that moves it along. Pages sit on a faintly cool grey canvas, with white reserved for cards, tools and controls.

The system is restrained by construction. One saturated blue carries action; everything else is a slate neutral or a pale tint. A rounded grotesque, Gabarito, gives headings a little warmth while Inter does the operational reading. Depth stays minimal: a barely visible card edge, a small lift on clickable cards, and real shadows for things that float. The system ships in light only: the dashboard defines no dark token values, and no code that switches the dark theme on was found.

Motion stays small and explains state. Statuses settle into place once a check returns, a row's editor rises four pixels when it opens, and the button's loading state is Hay's own three-peak mark breathing. Everything decorative stops under reduced motion.

**Key Characteristics:**

- White cards for areas of work, hairline rows for lists of entries
- One saturated blue for action, pale tints for status
- Status is always a word; color only reinforces it
- Nearly flat in the page, with real shadows for hover lift and floating layers
- Gabarito headings over Inter working text, on a 16px base
- Comfortable 44px touch targets below the tablet breakpoint

## Colors

A cool slate neutral field with a single electric blue, and pale green and amber tints that speak only about status.

### Primary

- **Hay Blue** (#001df5): Every primary button, text action, focus ring, selected control, progress fill and sidebar count badge. It marks what can be done next.
- **Blue Wash** (#e8f3ff): The quiet form of Hay Blue. It fills the next-step band, selected chips and choice rows, and the status pills for steps waiting on the person.

### Tertiary

- **Olive Agent Green** (#77951b): The success button and the human-agent message bubble in conversations.
- **Document Amber** (rgb(178, 97, 5)) and **Tool Purple** (#9333ea): Category colors that mark a kind of thing: document and tool content in chat and playbooks, plugin types, tool badges. They are not action colors.

### Neutral

- **Sheet White** (#ffffff): Controls, the sidebar, cards and tool panels that sit on the canvas.
- **Desk Grey** (neutral-50): The main content canvas behind every page, and the fill of secondary panels.
- **Quiet Slate Fill** (neutral-100): Hover fills, active navigation, answer tags, in-progress pills and skeleton blocks.
- **Slate Track** (neutral-200): Progress tracks and inactive step marks.
- **Hairline Slate** (neutral-300): Every border and input stroke by default, set globally.
- **Hover Slate** (neutral-400): Border darkening on hover for chips and choice rows.
- **Muted Slate** (neutral-500): Supporting text on white or Desk Grey: reasons, hints, placeholders.
- **Body Slate** (neutral-700): Default text color, and supporting text on Blue Wash.
- **Ink Slate** (neutral-900): Titles and the primary entry in a row.

### Status

- **Ready Tint and Ink** (success-tint on success-ink): Something works now.
- **Missing Tint and Ink** (warning-tint on warning-ink): Something is absent and the person can supply it.
- **Destructive Red** (#c63c3c): Error messages and destructive buttons. Errors are written out in text beside the control that caused them.

### Named Rules

**The One Blue Rule.** Hay Blue is the color of the ordinary next action. If an element is blue, it is interactive, selected, in progress or waiting on the person; status tints never stand in for an action. Red and green buttons are kept for explicit destructive or approving decisions.

**The Word First Rule.** A status is always a written word in a pill, and the reason sits next to it in plain text. Remove all color and the row must still read correctly.

**The Tint Shift Rule.** On Blue Wash, supporting text steps up from Muted Slate to Body Slate, because Muted Slate does not hold contrast on the tint.

## Typography

**Display Font:** Gabarito (with sans-serif)
**Body Font:** Inter (with sans-serif)

**Character:** Gabarito is a friendly geometric grotesque set by default at weight 500 with tight tracking, so headings feel settled rather than loud. Inter handles everything operational, with an optical size axis loaded and a calm default of 16px.

### Hierarchy

- **Display** (500, 1.875rem from the md breakpoint, 2.25rem line height; 1.5rem below it): The title of a focused flow, in Ink Slate.
- **Headline** (500, 1.5rem, line height 1): Standard page titles.
- **Title** (500, 1.25rem, line height 1): The default for section headings and card titles.
- **Section** (500, 1rem, 1.5rem line height): Gabarito headings of tool panels and sub-sections inside a working page.
- **Callout** (Inter 500, 1.125rem): The single statement in a next-step band. It is deliberately Inter, since it is a sentence to act on rather than a heading.
- **Body** (400, 1rem, 1.5): Default reading text and choice titles. **Body Strong** at 500 sets row entries and counts.
- **Body Small** (400, 0.875rem, 1.5): Reasons, hints, errors, tags and input text.
- **Label** (500, 0.875rem, 1.25rem line height): Buttons, field labels, navigation and text actions.
- **Caption** (400, 0.75rem): Source lines and notes under chat messages.
- **Pill** (600, 0.75rem): Status pills only.

### Named Rules

**The Sentence Case Rule.** Headings, labels, pills and actions are written in sentence case. Uppercase with wide tracking appears only on data table column headers and small dividers.

**The Two Weights Rule.** In working rows and forms, type uses 400 and 500. Weight 600 belongs to pills, which need the extra hold at 12px.

## Layout

The app is a fixed-height shell: a collapsible left sidebar on md and up, a top bar with a drawer on phones, and a scrolling main column on Desk Grey. Pages pad 1rem on phones and 1.5rem from md, with 1rem between major blocks by default.

Spacing runs on a 4px base. Working pages use a tight, consistent rhythm: 0.75rem vertical padding in rows, 1.25rem between stacked bands, 1.5rem between columns and between sections. Focused flows cap their content rather than filling the screen: 1120px for a stepped flow with a live aside, 1220px for a working board. A primary column takes the remaining width beside a 300 to 360px tool panel at lg, or a 300 to 420px aside with a 3.5rem gap.

Tool panels stick to the top of the scroll area at lg and stack below the content on smaller screens. A working row stacks its entry, status, reason and action below 1360px; from 1360px the list becomes one grid with each row a subgrid, so pills and reasons line up across rows. Below md, row actions and band buttons grow to 44px tall and band buttons go full width. On touch devices, fields are forced to 16px so iOS does not zoom on focus.

## Elevation & Depth

The system is nearly flat, with depth carried by tone and hairlines. A page stacks Desk Grey, Sheet White and Hairline Slate borders. Cards carry a barely visible edge shadow, clickable cards lift on hover, and real shadows belong to things floating above the page. Next-step bands, status rows and tool panels carry no shadow.

### Shadow Vocabulary

- **Card rest** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`): The generic card primitive.
- **Menu** (`box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)`): Dropdown menus, select lists, tooltips, and the hover lift on clickable cards.
- **Toast** (`box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`): Toast messages and the switch thumb.
- **Modal** (`box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)`): Dialogs and sheets.
- **Focus ring** (`box-shadow: 0 0 0 2px var(--color-background), 0 0 0 4px var(--color-ring)`): Buttons and inputs. A state, not elevation.

### Named Rules

**The Earned Shadow Rule.** A surface gets more than a card edge only when it responds to the pointer or sits above the page. Anything static in the page's flow separates with tone or a hairline.

## Shapes

Corners are gently rounded and grow with the size of the surface: about 5px for small inline code, about 6px for buttons, inputs and tags, 8px for bands, choice rows, cards and navigation items, 12px for tool panels, and 16px for dialogs. Pills, chips, progress bars and status dots are fully round, and that full round is the signal for "small status or selectable token".

Borders are 1px Hairline Slate, applied by default to everything that declares a border. Status lists and simple lists use a single bottom or top hairline with no side borders and no row backgrounds.

## Components

### Buttons

Plain, confident and one job each.

- **Shape:** Softly squared (0.375rem), 2.5rem tall by default; small is 2.25rem at 12px, large is 2.75rem.
- **Primary:** Hay Blue with white Label text, 1rem horizontal padding. At most one in a band or form.
- **Hover / Focus:** Hover mixes the fill to 90% over 150ms. Focus shows a 2px gap and 2px Hay Blue ring. Disabled drops to 50% opacity.
- **Outline:** Sheet White with a Hairline Slate stroke, for the quiet second action such as Finish later, Cancel and Retry; hover fills Quiet Slate.
- **Link:** Hay Blue text that underlines on hover, 4px offset, for row actions.
- **Loading:** The label fades out in place, so the width holds, and Hay's three-peak mark pulses over it.

### Status Pills

- **Style:** Fully round, Pill type, 0.125rem by 0.625rem padding, no border.
- **State:** Ready and connected use the green tint; missing uses the amber tint; anything waiting on the person uses Blue Wash; checking and reading use Quiet Slate with Muted Slate text; a failed check uses a Hairline Slate outline on white.
- **Motion:** A pill re-keys when its status changes and settles in over 450ms, rising 4px on `cubic-bezier(0.16, 1, 0.3, 1)`.

### Chips and Tags

- **Selectable chip:** A real checkbox behind a fully round, stroked label (0.375rem by 0.875rem padding). Selected turns Blue Wash with a Hay Blue stroke and Label-weight blue text; unselected hovers to a darker stroke.
- **Answer tag:** A non-interactive Quiet Slate label (about 6px corners) that reflects what the person already told the product.

### Cards / Containers

- **Corner Style:** 8px for the card primitive; 12px for tool panels.
- **Background:** Sheet White on the canvas; secondary panels such as an inline install panel use Desk Grey with a white code block inside.
- **Shadow Strategy:** Card rest for the card primitive, the Menu shadow on hover for clickable cards, none for working panels.
- **Border:** One Hairline Slate stroke.
- **Internal Padding:** 1.5rem for cards; 1rem for panels.

### Inputs / Fields

- **Style:** Hairline Slate stroke on Sheet White, about 6px corners, 2.5rem tall, Body Small text, 0.75rem horizontal padding. Labels sit above in Label type with a 0.5rem gap.
- **Focus:** The same 2px gap and 2px Hay Blue ring as buttons, over 200ms.
- **Error / Disabled:** Error turns the stroke and ring Destructive Red with a written message below; disabled drops to 50% opacity.

### Choice Rows

Full-width selectable rows holding a native radio or checkbox tinted Hay Blue, a Body Strong title and a Body Small hint. 8px corners, 0.75rem padding, Hairline Slate stroke that darkens on hover. Selected adds a Hay Blue stroke and Blue Wash fill; focus rings the whole row.

### Navigation

- **Style:** Sidebar items are Label type with a 16px Lucide line icon and 0.75rem gap, 8px corners, 44px tall below md.
- **States:** Hover and active fill Quiet Slate; there is no blue active state. Counts and progress sit at the far end in a solid Hay Blue pill.
- **Mobile:** The same items in a left drawer opened from the top bar.

### Next Step Band

The one thing to do next, across the full width of the content. A Blue Wash band with 8px corners, a Callout sentence and a Body Small reason in Body Slate on the left, and one primary button at the far end. When nothing is left it turns to Desk Grey with a hairline border and a Ready pill, giving up the blue because nothing is being asked for.

### Status Rows

A list of real entries on the bare canvas, each a Body Strong entry, a status pill, a Muted Slate reason and a single text action, divided by bottom hairlines with 0.75rem vertical padding. A row can expand in place for its editor or review, rising 4px over 300ms, with focus moved into the field and handed back on close. A count and a 6px progress bar sit above the list; counts report what is true rather than a score.

### Tool Panel

A working tool beside the content: Sheet White, 12px corners, one hairline stroke, a Section heading over a bottom hairline, a scrolling body and a pinned form with a square primary send button. It sits sticky at lg, capped at 600px tall, and is a fixed 440px tall when stacked. Replies that draw on a source name it in a Caption line beneath the message.

### Sidebar Progress Card

A small white card in the sidebar footer, 8px corners, 0.75rem padding: a count, a 6px progress bar, the next step in Muted Slate and a text action back to the flow. It appears only away from that flow, while something is left to do.

## Do's and Don'ts

### Do:

- **Do** keep one primary button per band or form, and pair it with Outline or Link for anything else.
- **Do** write every status as a word in a pill with its reason beside it, and show errors as Destructive Red text next to the control that failed.
- **Do** separate list entries with a single Hairline Slate rule on the bare canvas, with 0.75rem vertical padding.
- **Do** use Blue Wash with Body Slate text for anything waiting on the person.
- **Do** give every interactive element a 44px minimum height below md, and keep the 2px gap plus 2px Hay Blue focus ring.
- **Do** honor reduced motion: settle and expand animations, staggered reveals and smooth scrolling all stop under it.
- **Do** use `cubic-bezier(0.16, 1, 0.3, 1)` with a 4px rise at 300 to 450ms for state that arrives, and 150ms for hover and press.

### Don't:

- **Don't** fill a status pill with a saturated color on a working row; statuses use pale tints so that Hay Blue stays the loudest thing on the page.
- **Don't** use category colors such as Document Amber or Tool Purple for actions or selection.
- **Don't** give next-step bands, status rows or tool panels a shadow; they stay in the page's flow.
- **Don't** wrap each status row in its own card; the row's hairline is its container.
- **Don't** set body or supporting copy in Gabarito.
- **Don't** put Muted Slate text on Blue Wash; step up to Body Slate.
