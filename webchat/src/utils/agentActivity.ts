/**
 * The "AI is acting on this page" overlay: an orange frame around the
 * viewport, a status pill, a cursor that travels to whatever the tool points
 * at, and a highlight box around that element. Shown while a page tool runs
 * (see useChat) and available to tools through `window.HayChat.highlight`.
 *
 * Plain DOM, no Vue: it sits on the host page, outside the widget root, and
 * must cost nothing until the first tool call.
 */

const ROOT_ID = "hay-agent-activity";
const ORANGE = "#f97316";
/** A standalone highlight (no tool running) fades after this long. */
const STANDALONE_HIGHLIGHT_MS = 2500;
/** After a tool ends, the highlight lingers so the visitor sees what changed. */
const LINGER_MS = 1200;

const CSS = `
#${ROOT_ID}{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font:13px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;opacity:0;transition:opacity .25s ease}
#${ROOT_ID}[data-on]{opacity:1}
#${ROOT_ID} .hay-agent-frame{position:absolute;inset:0;box-shadow:inset 0 0 0 3px ${ORANGE},inset 0 0 28px rgba(249,115,22,.28);animation:hay-agent-breathe 1.6s ease-in-out infinite}
#${ROOT_ID} .hay-agent-pill{position:absolute;top:12px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;max-width:min(80vw,420px);padding:7px 14px 7px 10px;border-radius:999px;background:${ORANGE};color:#fff;font-weight:600;box-shadow:0 6px 20px rgba(249,115,22,.35);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#${ROOT_ID} .hay-agent-pill b{font-weight:700;opacity:.9}
#${ROOT_ID} .hay-agent-dot{width:8px;height:8px;border-radius:50%;background:#fff;animation:hay-agent-blink 1s ease-in-out infinite}
#${ROOT_ID} .hay-agent-cursor{position:absolute;left:0;top:0;width:22px;height:22px;transform:translate(-100px,-100px);transition:transform .5s cubic-bezier(.2,.7,.2,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
#${ROOT_ID} .hay-agent-box{position:absolute;border:2px solid ${ORANGE};border-radius:8px;box-shadow:0 0 0 4px rgba(249,115,22,.22);transition:all .3s ease;opacity:0}
#${ROOT_ID} .hay-agent-box[data-on]{opacity:1}
#${ROOT_ID} .hay-agent-label{position:absolute;left:-2px;bottom:100%;margin-bottom:6px;padding:3px 8px;border-radius:6px;background:${ORANGE};color:#fff;font-weight:600;white-space:nowrap}
@keyframes hay-agent-breathe{0%,100%{opacity:.75}50%{opacity:1}}
@keyframes hay-agent-blink{0%,100%{opacity:.4}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){#${ROOT_ID} *{animation:none!important;transition:none!important}}
`;

const CURSOR_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 2l16 7.5-7 2.2-2.6 7.3z" fill="${ORANGE}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

interface Overlay {
  root: HTMLElement;
  pillText: HTMLElement;
  cursor: HTMLElement;
  box: HTMLElement;
  label: HTMLElement;
}

let overlay: Overlay | null = null;
let active = false;
let target: Element | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let highlightTimer: ReturnType<typeof setTimeout> | null = null;

function ensureOverlay(): Overlay {
  if (overlay) return overlay;
  const style = document.createElement("style");
  style.id = `${ROOT_ID}-style`;
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.setAttribute("aria-live", "polite");
  root.innerHTML =
    `<div class="hay-agent-frame"></div>` +
    `<div class="hay-agent-pill"><span class="hay-agent-dot"></span><span class="hay-agent-text"></span></div>` +
    `<div class="hay-agent-box"><span class="hay-agent-label"></span></div>` +
    `<div class="hay-agent-cursor">${CURSOR_SVG}</div>`;
  document.body.appendChild(root);
  window.addEventListener("scroll", reposition, { passive: true, capture: true });
  window.addEventListener("resize", reposition, { passive: true });

  overlay = {
    root,
    pillText: root.querySelector(".hay-agent-text") as HTMLElement,
    cursor: root.querySelector(".hay-agent-cursor") as HTMLElement,
    box: root.querySelector(".hay-agent-box") as HTMLElement,
    label: root.querySelector(".hay-agent-label") as HTMLElement,
  };
  return overlay;
}

function clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
  if (timer) clearTimeout(timer);
  return null;
}

/** Place the box and the cursor on the current target (or park them). */
function reposition(): void {
  if (!overlay) return;
  const { box, cursor } = overlay;
  if (!target || !target.isConnected) {
    box.removeAttribute("data-on");
    if (active) {
      // Park the cursor under the pill while nothing is pointed at.
      cursor.style.transform = `translate(${window.innerWidth / 2 + 24}px, 44px)`;
    }
    return;
  }
  const rect = target.getBoundingClientRect();
  box.style.left = `${rect.left - 4}px`;
  box.style.top = `${rect.top - 4}px`;
  box.style.width = `${rect.width + 8}px`;
  box.style.height = `${rect.height + 8}px`;
  box.setAttribute("data-on", "");
  cursor.style.transform = `translate(${rect.left + rect.width / 2}px, ${rect.top + rect.height / 2}px)`;
}

/** "Hay · Open integrations": the agent's name and what it is doing. */
export function startActivity(who: string, what: string): void {
  const ui = ensureOverlay();
  hideTimer = clearTimer(hideTimer);
  active = true;
  ui.pillText.innerHTML = "";
  const name = document.createElement("b");
  name.textContent = `${who} · `;
  ui.pillText.append(name, document.createTextNode(what));
  ui.root.setAttribute("data-on", "");
  reposition();
}

export function setActivityLabel(what: string): void {
  if (!overlay || !active) return;
  const name = overlay.pillText.querySelector("b");
  overlay.pillText.textContent = "";
  if (name) overlay.pillText.append(name);
  overlay.pillText.append(document.createTextNode(what));
}

/** The tool finished: keep the highlight a moment, then fade everything out. */
export function endActivity(): void {
  if (!overlay) return;
  active = false;
  hideTimer = clearTimer(hideTimer);
  hideTimer = setTimeout(hideAll, target ? LINGER_MS : 150);
}

function hideAll(): void {
  if (!overlay) return;
  target = null;
  overlay.root.removeAttribute("data-on");
  overlay.box.removeAttribute("data-on");
  overlay.cursor.style.transform = "translate(-100px,-100px)";
}

/**
 * Point at an element (selector or node): scroll it into view, draw the box,
 * move the cursor there. Returns false when nothing matched. Outside a running
 * tool the highlight shows on its own and fades by itself.
 */
export function highlight(where: Element | string | null, label?: string): boolean {
  const element =
    typeof where === "string" ? safeQuery(where) : where instanceof Element ? where : null;
  if (!element) return false;
  const ui = ensureOverlay();
  target = element;
  ui.label.textContent = label ?? "";
  ui.label.style.display = label ? "" : "none";
  try {
    element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  } catch {
    // Older browsers: no smooth scrolling, the box still lands on the element.
  }
  if (!active) {
    ui.root.setAttribute("data-on", "");
    hideTimer = clearTimer(hideTimer);
    hideTimer = setTimeout(hideAll, STANDALONE_HIGHLIGHT_MS);
  }
  reposition();
  // Smooth scrolling moves the target after we measured it.
  highlightTimer = clearTimer(highlightTimer);
  highlightTimer = setTimeout(reposition, 450);
  return true;
}

function safeQuery(selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

/** Tests only. */
export function resetActivity(): void {
  hideTimer = clearTimer(hideTimer);
  highlightTimer = clearTimer(highlightTimer);
  active = false;
  target = null;
  overlay?.root.remove();
  document.getElementById(`${ROOT_ID}-style`)?.remove();
  overlay = null;
}

export const ACTIVITY_ROOT_ID = ROOT_ID;
