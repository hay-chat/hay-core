/**
 * The pages of the public help center, as HTML strings. Everything here goes
 * through the `html` tag, so values are escaped unless they are already
 * `SafeHtml` (the sanitised article body, and the fixed scripts below).
 */
import type { HelpCenterTheme } from "@server/database/entities/help-center.entity";
import type { PublicArticle, PublicArticleSummary, PublicCollection } from "../public-content";
import { SEARCH_QUERY_MAX_LENGTH } from "../public-content";
import { html, raw, scriptJson, type HtmlValue, type SafeHtml } from "./html";
import { htmlLang, siteStrings, type SiteStrings } from "./strings";
import { SITE_CSS_PATH, themeCss } from "./styles";
import { articlePath, collectionPath } from "./urls";

export const PREVIEW_TOKEN_PARAM = "hc_preview";
export const PREVIEW_THEME_PARAM = "hc_theme";
export const FEEDBACK_PATH = "/_hc/feedback";
const POWERED_BY_URL = "https://hay.chat";

/** What every page needs to know about the site and the request. */
export interface SiteView {
  /** The help center's name; empty on a host that has no site to show. */
  name: string;
  language: string;
  /** Canonical address of the site, without a trailing slash. */
  canonicalBase: string;
  theme: HelpCenterTheme;
  logoUrl: string | null;
  noindex: boolean;
  /** CSP nonce of this response. */
  nonce: string;
  /** Set in the dashboard's preview: carried on every link so navigation stays in preview. */
  preview: { token: string; theme: string | null } | null;
  /** Set when the organization's chat widget goes on the page. */
  webchat: { organizationId: string; baseUrl: string } | null;
}

function previewParams(view: SiteView): Array<[string, string]> {
  if (!view.preview) return [];
  const params: Array<[string, string]> = [[PREVIEW_TOKEN_PARAM, view.preview.token]];
  if (view.preview.theme) params.push([PREVIEW_THEME_PARAM, view.preview.theme]);
  return params;
}

/** A link inside the site. */
export function siteHref(view: SiteView, path: string): string {
  const query = new URLSearchParams(previewParams(view)).toString();
  return query ? `${path}?${query}` : path;
}

/** The fields a GET form needs to stay in preview (a form's action loses its query string). */
function previewFields(view: SiteView): SafeHtml[] {
  return previewParams(view).map(
    ([name, value]) => html`<input type="hidden" name="${name}" value="${value}" />`,
  );
}

function searchForm(view: SiteView, strings: SiteStrings, inputId: string, query = ""): SafeHtml {
  return html`<form class="hc-search" role="search" action="/search" method="get">
    <label class="hc-sr-only" for="${inputId}">${strings.search}</label>
    <input
      type="search"
      id="${inputId}"
      name="q"
      value="${query}"
      placeholder="${strings.searchPlaceholder}"
      maxlength="${SEARCH_QUERY_MAX_LENGTH}"
      required
    />
    ${previewFields(view)}<button type="submit">${strings.search}</button>
  </form>`;
}

/**
 * Feedback buttons need a script; without one the block simply stays hidden.
 * In the dashboard's preview the buttons work but nothing is counted.
 */
const FEEDBACK_SCRIPT = raw(`(function () {
  var box = document.querySelector("[data-hc-feedback]");
  if (!box || !window.fetch) return;
  box.hidden = false;
  box.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-helpful]");
    if (!button) return;
    if (!box.hasAttribute("data-hc-preview")) {
      fetch(${JSON.stringify(FEEDBACK_PATH)}, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleId: box.getAttribute("data-hc-feedback"),
          helpful: button.getAttribute("data-helpful") === "true"
        })
      }).catch(function () {});
    }
    box.querySelector("[data-hc-buttons]").hidden = true;
    box.querySelector("[data-hc-thanks]").hidden = false;
  });
})()`);

function webchatSnippet(view: SiteView, context: Record<string, string> | null): HtmlValue {
  if (!view.webchat) return null;
  const config = { ...view.webchat, ...(context ? { context } : {}) };
  return html`<script nonce="${view.nonce}">
      window.HayChat = window.HayChat || {};
      window.HayChat.config = ${scriptJson(config)};
    </script>
    <script
      nonce="${view.nonce}"
      src="${view.webchat.baseUrl}/v1/webchat/widget.js"
      async
    ></script>`;
}

interface PageParts {
  /** Page title; the site name is appended. Null on the home page. */
  title: string | null;
  description?: string | null;
  /** Path of the page for `<link rel="canonical">`; null where there is none (404, search). */
  canonicalPath: string | null;
  noindex?: boolean;
  /** Shown between the header and the main content, full width. */
  hero?: SafeHtml;
  /** The header's small search box is left out where the page has its own. */
  headerSearch?: boolean;
  main: SafeHtml;
  scripts?: HtmlValue;
  /** Passed to the chat widget so the assistant knows what the visitor is reading. */
  chatContext?: Record<string, string>;
  narrow?: boolean;
}

function page(view: SiteView, strings: SiteStrings, parts: PageParts): string {
  const title = [parts.title, view.name].filter(Boolean).join(" · ");
  const brand = view.name
    ? html`<a class="hc-brand" href="${siteHref(view, "/")}"
        >${view.logoUrl ? html`<img src="${view.logoUrl}" alt="" />` : null}<span
          >${view.name}</span
        ></a
      >`
    : null;
  return html`<!doctype html>
    <html lang="${htmlLang(view.language)}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>${title}</title>
        ${parts.description ? html`<meta name="description" content="${parts.description}" />` : null}
        ${
          parts.canonicalPath
            ? html`<link rel="canonical" href="${view.canonicalBase}${parts.canonicalPath}" />`
            : null
        }
        ${view.noindex || parts.noindex ? html`<meta name="robots" content="noindex" />` : null}
        <link rel="icon" href="${view.logoUrl ?? "data:,"}" />
        <link rel="stylesheet" href="${SITE_CSS_PATH}" />
        <style nonce="${view.nonce}">
          ${themeCss(view.theme)}
        </style>
      </head>
      <body>
        <a class="hc-skip" href="#hc-main">${strings.skipToContent}</a>
        <header class="hc-header">
          <div class="hc-wrap">
            ${brand}${
              view.name && parts.headerSearch !== false
                ? searchForm(view, strings, "hc-header-search")
                : null
            }
          </div>
        </header>
        ${parts.hero}
        <main id="hc-main" class="hc-main hc-wrap${parts.narrow ? " hc-narrow" : ""}">
          ${parts.main}
        </main>
        ${
          view.theme.showPoweredBy !== false
            ? html`<footer class="hc-footer">
                <div class="hc-wrap">
                  <a href="${POWERED_BY_URL}" rel="noopener">${strings.poweredBy}</a>
                </div>
              </footer>`
            : null
        }
        ${parts.scripts} ${webchatSnippet(view, parts.chatContext ?? null)}
      </body>
    </html> `.value;
}

function articleLinks(view: SiteView, articles: PublicArticleSummary[]): SafeHtml {
  return html`<ul class="hc-articles">
    ${articles.map(
      (article) =>
        html`<li>
          <a href="${siteHref(view, articlePath(article))}">${article.title}</a>${
            article.description ? html`<p>${article.description}</p>` : null
          }
        </li>`,
    )}
  </ul>`;
}

function breadcrumb(view: SiteView, trail: Array<{ label: string; path: string }>): SafeHtml {
  return html`<nav class="hc-breadcrumb" aria-label="Breadcrumb">
    <ol>
      ${trail.map(
        (step) => html`<li><a href="${siteHref(view, step.path)}">${step.label}</a></li>`,
      )}
    </ol>
  </nav>`;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function renderHomePage(view: SiteView, collections: PublicCollection[]): string {
  const strings = siteStrings(view.language);
  const subtitle = text(view.theme.heroSubtitle);
  const hero = html`<section class="hc-hero">
    <div class="hc-wrap">
      <h1>${text(view.theme.heroTitle) ?? view.name}</h1>
      ${subtitle ? html`<p>${subtitle}</p>` : null} ${searchForm(view, strings, "hc-search")}
    </div>
  </section>`;

  const cards = html`<ul class="hc-cards">
    ${collections.map(
      (collection) =>
        html`<li>
          <a class="hc-card" href="${siteHref(view, collectionPath(collection))}">
            ${collection.icon ? html`<span class="hc-card-icon" aria-hidden="true">${collection.icon}</span>` : null}
            <h2>${collection.title}</h2>
            ${collection.description ? html`<p>${collection.description}</p>` : null}
            <p class="hc-count">${strings.articleCount(collection.articles.length)}</p>
          </a>
        </li>`,
    )}
  </ul>`;
  const list = collections.map(
    (collection) =>
      html`<section class="hc-section">
        <h2>
          <a href="${siteHref(view, collectionPath(collection))}"
            >${
              collection.icon ? html`<span aria-hidden="true">${collection.icon} </span>` : null
            }${collection.title}</a
          >
        </h2>
        ${articleLinks(view, collection.articles)}
      </section>`,
  );

  return page(view, strings, {
    title: null,
    description: subtitle,
    canonicalPath: "/",
    hero,
    headerSearch: false,
    main: html`<h2 class="hc-sr-only">${strings.collections}</h2>
      ${view.theme.layout === "list" ? list : cards}`,
  });
}

export function renderCollectionPage(view: SiteView, collection: PublicCollection): string {
  const strings = siteStrings(view.language);
  return page(view, strings, {
    title: collection.title,
    description: collection.description,
    canonicalPath: collectionPath(collection),
    main: html`${breadcrumb(view, [{ label: view.name, path: "/" }])}
      <h1>
        ${
          collection.icon ? html`<span aria-hidden="true">${collection.icon} </span>` : null
        }${collection.title}
      </h1>
      <p class="hc-lead">
        ${collection.description ?? strings.articleCount(collection.articles.length)}
      </p>
      ${articleLinks(view, collection.articles)}`,
  });
}

export function renderArticlePage(view: SiteView, article: PublicArticle, body: SafeHtml): string {
  const strings = siteStrings(view.language);
  const path = articlePath(article);
  return page(view, strings, {
    title: article.title,
    description: article.description,
    canonicalPath: path,
    narrow: true,
    main: html`${breadcrumb(view, [
        { label: view.name, path: "/" },
        { label: article.collection.title, path: collectionPath(article.collection) },
      ])}
      <article>
        <h1>${article.title}</h1>
        <div class="hc-prose">${body}</div>
      </article>
      <section
        class="hc-panel"
        data-hc-feedback="${article.id}"
        ${view.preview ? raw("data-hc-preview") : null}
        aria-labelledby="hc-feedback-title"
        hidden
      >
        <h2 id="hc-feedback-title">${strings.helpfulQuestion}</h2>
        <div class="hc-feedback-buttons" data-hc-buttons>
          <button type="button" data-helpful="true">${strings.yes}</button>
          <button type="button" data-helpful="false">${strings.no}</button>
        </div>
        <p role="status" data-hc-thanks hidden>${strings.feedbackThanks}</p>
      </section>
      ${
        view.webchat
          ? html`<section class="hc-panel">
              <h2>${strings.stillNeedHelp}</h2>
              <p>${strings.chatWithUs}</p>
            </section>`
          : null
      }`,
    scripts: html`<script nonce="${view.nonce}">
      ${FEEDBACK_SCRIPT};
    </script>`,
    chatContext: {
      helpCenterArticleTitle: article.title,
      helpCenterArticleUrl: view.canonicalBase + path,
    },
  });
}

export function renderSearchPage(
  view: SiteView,
  query: string,
  results: PublicArticleSummary[],
): string {
  const strings = siteStrings(view.language);
  return page(view, strings, {
    title: query ? `${strings.search}: ${query}` : strings.search,
    canonicalPath: null,
    // Result pages are endless variations of the same content.
    noindex: true,
    headerSearch: false,
    main: html`${breadcrumb(view, [{ label: view.name, path: "/" }])}
      <h1>${strings.search}</h1>
      ${searchForm(view, strings, "hc-search", query)}
      <div class="hc-section">
        ${
          results.length > 0
            ? articleLinks(view, results)
            : query
              ? html`<p class="hc-lead">${strings.noResults}</p>`
              : null
        }
      </div>`,
  });
}

/** Also what a host with no site (or an offline one) answers: `view.name` is empty then. */
export function renderNotFoundPage(view: SiteView): string {
  const strings = siteStrings(view.language);
  return page(view, strings, {
    title: strings.pageNotFound,
    canonicalPath: null,
    noindex: true,
    narrow: true,
    main: html`<h1>${strings.pageNotFound}</h1>
      ${view.name ? html`<p class="hc-lead"><a href="${siteHref(view, "/")}">${strings.backToHome}</a></p>` : null}`,
  });
}
