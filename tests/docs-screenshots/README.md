# Docs screenshots

Takes the screenshots used in [hay-docs](https://github.com/hay-chat/hay-docs) from a local
dashboard filled with demo data, so the images can be redone whenever the UI changes.

```bash
npm run docs:screenshots
```

What it does:

1. **Seeds** a "Casa Aurora" organization in your local database
   (`server/scripts/seed-docs-screenshots.ts`, also `cd server && npm run docs:seed`). It deletes and
   rebuilds only that organization and refuses to run unless `NODE_ENV=development` and the database
   is local. Timestamps are relative to now, so wait times and charts look the same on every run.
2. **Captures** each test in `*.shots.ts` with Playwright at 1440×900, 2× pixel density, light theme,
   `en-US`, with animations and carets off.
3. **Writes** each image into hay-docs: the `docs/` submodule by default
   (`git submodule update --init docs`), or another checkout with `DOCS_DIR=../hay-docs`.

It needs the API and dashboard running locally (`npm run dev`), as for the E2E tests.

Useful options:

```bash
npm run docs:screenshots -- -g inbox              # only shots whose name contains "inbox"
DOCS_DIR=../hay-docs npm run docs:screenshots     # write into a separate hay-docs checkout
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium npm run docs:screenshots  # use an installed Chromium
```

## Adding a screenshot

Add a test to `user-guide.shots.ts`:

```ts
test("inbox: question for the team", async ({ page }) => {
  await open(page, "/inbox", "Questions for the team"); // waits for this text before shooting
  const card = page.getByRole("listitem").filter({ hasText: "Liam O'Connor" });
  await shoot(page, {
    name: "user-guide/images/inbox/question-for-the-team", // path in hay-docs, no extension
    clip: card, // crop to an element; omit for the whole window
    highlight: [
      { target: card.getByRole("textbox"), label: "1" }, // box + numbered badge
      { target: [card.getByRole("switch"), card.getByText("Send as written")], label: "2" }, // one box around both
    ],
  });
});
```

Then reference it from the doc page with a path relative to the page:

```md
![The Questions for the team card in the Inbox](images/inbox/question-for-the-team.png)
```

The hay-website build turns these into optimized AVIF/WebP images, and the links also work when
reading the Markdown on GitHub.

Guidelines:

- **Wait for real content** (`open(page, path, "<text>")`, `expect(...).toBeVisible()`), never a fixed
  timeout, so a loading skeleton fails the run instead of ending up in the docs.
- **Target elements by role and visible text** (`getByRole("button", { name: "Approve" })`). If an
  element has no accessible name, add an `aria-label` to the component. That is better for
  accessibility too.
- A missing or ambiguous highlight target fails the run. When a UI change breaks a shot, fix the
  locator or the doc, don't skip it.
- Number badges should match the numbered steps in the doc text.
- Need different data on screen? Add it to the seed, not to the test.
