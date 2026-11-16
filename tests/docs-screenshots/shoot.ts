import * as fs from "fs";
import * as path from "path";
import type { Locator, Page } from "@playwright/test";
import { DOCS_SEED_IDS } from "./paths";

/**
 * Where hay-docs lives. Defaults to the `docs/` submodule; set DOCS_DIR to write into another
 * checkout of hay-chat/hay-docs.
 */
const DOCS_DIR = path.resolve(process.env.DOCS_DIR ?? path.join(__dirname, "../../docs"));

export function seedIds(): {
  featuredConversationId: string;
  playbookId: string;
  documentId: string;
} {
  return JSON.parse(fs.readFileSync(DOCS_SEED_IDS, "utf8"));
}

export interface Highlight {
  /** One element, or several that get a single box drawn around all of them. */
  target: Locator | Locator[];
  /** Shown in a badge on the box's top-left corner, e.g. "1". Matches a numbered step in the doc. */
  label?: string;
}

export interface ShotOptions {
  /** Path inside hay-docs, without extension, e.g. "user-guide/images/inbox/overview". */
  name: string;
  /** Crop to this element. Defaults to the whole window. */
  clip?: Locator;
  /** Extra space kept around `clip`, in CSS pixels. */
  padding?: number;
  highlight?: Highlight[];
}

const OVERLAY_CLASS = "docs-shot-overlay";

/** The smallest box around every target. Fails when one is missing or ambiguous. */
async function unionBox(
  targets: Locator[],
): Promise<{ x: number; y: number; width: number; height: number }> {
  const boxes = [];
  for (const target of targets) {
    await target.waitFor({ state: "visible" });
    const box = await target.boundingBox();
    if (!box) throw new Error(`Highlight target has no box: ${target}`);
    boxes.push(box);
  }
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Fails the shot when a highlighted element is missing: a stale screenshot must not slip through. */
async function drawHighlights(page: Page, highlights: Highlight[]): Promise<void> {
  for (const { target, label } of highlights) {
    const box = await unionBox(Array.isArray(target) ? target : [target]);
    await page.evaluate(
      ({ box, label, cls }) => {
        const pad = 3;
        const el = document.createElement("div");
        el.className = cls;
        Object.assign(el.style, {
          position: "fixed",
          left: `${box.x - pad}px`,
          top: `${box.y - pad}px`,
          width: `${box.width + pad * 2}px`,
          height: `${box.height + pad * 2}px`,
          border: "3px solid #f5b400",
          borderRadius: "8px",
          boxShadow: "0 0 0 4px rgba(245, 180, 0, 0.25)",
          pointerEvents: "none",
          zIndex: "2147483647",
        });
        if (label) {
          const badge = document.createElement("span");
          badge.textContent = label;
          Object.assign(badge.style, {
            position: "absolute",
            left: "-14px",
            top: "-14px",
            width: "24px",
            height: "24px",
            borderRadius: "999px",
            background: "#f5b400",
            color: "#1a1a1a",
            font: "700 13px/24px system-ui, sans-serif",
            textAlign: "center",
          });
          el.appendChild(badge);
        }
        document.body.appendChild(el);
      },
      { box, label, cls: OVERLAY_CLASS },
    );
  }
}

/** Takes one docs screenshot and writes it to `<DOCS_DIR>/<name>.png`. */
export async function shoot(page: Page, options: ShotOptions): Promise<void> {
  // Hide carets, scrollbars, toasts and dev-only overlays that would differ between runs.
  await page.addStyleTag({
    content: `
      *, *::before, *::after { caret-color: transparent !important; transition: none !important; animation: none !important; }
      ::-webkit-scrollbar { display: none; }
      [data-sonner-toaster], nuxt-devtools-frame, #nuxt-devtools-container { display: none !important; }
    `,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    (cls) => document.querySelectorAll(`.${cls}`).forEach((n) => n.remove()),
    OVERLAY_CLASS,
  );
  if (options.highlight?.length) await drawHighlights(page, options.highlight);

  const file = path.join(DOCS_DIR, `${options.name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  if (options.clip) {
    await options.clip.waitFor({ state: "visible" });
    const box = await options.clip.boundingBox();
    if (!box) throw new Error(`Clip target has no box: ${options.clip}`);
    const pad = options.padding ?? 16;
    const viewport = page.viewportSize()!;
    const x = Math.max(0, box.x - pad);
    const y = Math.max(0, box.y - pad);
    await page.screenshot({
      path: file,
      clip: {
        x,
        y,
        width: Math.min(viewport.width - x, box.width + pad * 2),
        height: Math.min(viewport.height - y, box.height + pad * 2),
      },
    });
  } else {
    await page.screenshot({ path: file });
  }
}
