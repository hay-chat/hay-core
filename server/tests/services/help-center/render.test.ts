/**
 * The help center's rendering helpers, without a database: escaping, page
 * addresses, article bodies, theme variables, robots.txt and the sitemap.
 */
import { describe, it, expect } from "@jest/globals";
import { DEFAULT_HELP_CENTER_THEME } from "../../../database/entities/help-center.entity";
import { likePattern, normalizeSearchQuery } from "../../../services/help-center/public-content";
import {
  prepareForPage,
  sanitizedArticleHtml,
} from "../../../services/help-center/render/article-body";
import { html, raw, scriptJson } from "../../../services/help-center/render/html";
import {
  renderArticlePage,
  renderCollectionPage,
  renderHomePage,
  renderNotFoundPage,
  renderSearchPage,
  type SiteView,
} from "../../../services/help-center/render/pages";
import { buildRobotsTxt, buildSitemapXml } from "../../../services/help-center/render/seo";
import { htmlLang, siteStrings } from "../../../services/help-center/render/strings";
import {
  bodyClass,
  contrastRatio,
  heroClass,
  readableTextOn,
  SITE_CSS,
  SITE_CSS_PATH,
  themeCss,
} from "../../../services/help-center/render/styles";
import {
  articlePath,
  collectionPath,
  idRange,
  parseSlugId,
  slugify,
} from "../../../services/help-center/render/urls";

const ID = "0a1b2c3d-1111-4222-8333-444455556666";

describe("html", () => {
  it("escapes interpolated text", () => {
    expect(html`<p>${"<script>alert(1)</script> & co"}</p>`.value).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; co</p>",
    );
  });

  it("keeps a value inside its quoted attribute", () => {
    const rendered = html`<a href="${'" onmouseover="alert(1)'}" title="${"' x=`y`"}">x</a>`.value;
    expect(rendered).toBe(
      '<a href="&quot; onmouseover=&quot;alert(1)" title="&#39; x=&#96;y&#96;">x</a>',
    );
    expect(rendered.match(/"/g)).toHaveLength(4);
  });

  it("passes safe markup through, escapes everything in arrays, and drops empty values", () => {
    const inner = html`<b>${"a<b"}</b>`;
    expect(html`${inner}${raw("<hr>")}${["<i>", inner]}${null}${undefined}${false}${0}`.value).toBe(
      "<b>a&lt;b</b><hr>&lt;i&gt;<b>a&lt;b</b>0",
    );
  });

  it("makes JSON safe inside a script element", () => {
    const json = scriptJson({ title: "</script><script>alert(1)//", amp: "&", sep: " " }).value;
    expect(json).not.toContain("<");
    expect(json).not.toContain(">");
    expect(json).not.toContain("&");
    expect(json).not.toContain(" ");
    expect(JSON.parse(json)).toEqual({
      title: "</script><script>alert(1)//",
      amp: "&",
      sep: " ",
    });
  });
});

describe("page addresses", () => {
  it("slugifies titles to lowercase latin words", () => {
    expect(slugify("  How do I réinitialiser my Password? ")).toBe(
      "how-do-i-reinitialiser-my-password",
    );
    expect(slugify("日本語のタイトル")).toBe("");
    expect(slugify("a".repeat(200)).length).toBe(80);
    expect(slugify(`${"a".repeat(79)} b`)).toBe("a".repeat(79));
  });

  it("builds article and collection paths ending in the id8", () => {
    expect(articlePath({ id: ID, title: "Reset your password" })).toBe(
      "/articles/reset-your-password-0a1b2c3d",
    );
    expect(collectionPath({ id: ID.toUpperCase(), title: "Billing & plans" })).toBe(
      "/collections/billing-plans-0a1b2c3d",
    );
    expect(articlePath({ id: ID, title: "使い方" })).toBe("/articles/0a1b2c3d");
    expect(articlePath({ id: ID, title: null })).toBe("/articles/0a1b2c3d");
  });

  it("reads the id8 back from a path segment", () => {
    expect(parseSlugId("reset-your-password-0a1b2c3d")).toBe("0a1b2c3d");
    expect(parseSlugId("0a1b2c3d")).toBe("0a1b2c3d");
    expect(parseSlugId("anything-else-deadbeef")).toBe("deadbeef");
    for (const bad of [
      "",
      "reset",
      "0a1b2c3",
      "x-0A1B2C3D",
      "a_b-0a1b2c3d",
      "../0a1b2c3d",
      "%-0a1b2c3d",
    ]) {
      expect(parseSlugId(bad)).toBeNull();
    }
  });

  it("turns an id8 or a uuid into a uuid range and refuses anything else", () => {
    expect(idRange("0a1b2c3d")).toEqual({
      from: "0a1b2c3d-0000-0000-0000-000000000000",
      to: "0a1b2c3d-ffff-ffff-ffff-ffffffffffff",
    });
    expect(idRange(ID.toUpperCase())).toEqual({ from: ID, to: ID });
    expect(idRange("0a1b2c3d' OR 1=1")).toBeNull();
    expect(idRange("%")).toBeNull();
  });
});

describe("search input", () => {
  it("trims, collapses whitespace and caps the query", () => {
    expect(normalizeSearchQuery("  reset \n  password ")).toBe("reset password");
    expect(normalizeSearchQuery("x".repeat(500))).toHaveLength(100);
    expect(normalizeSearchQuery(["a"])).toBe("");
    expect(normalizeSearchQuery(undefined)).toBe("");
  });

  it("matches wildcard characters literally", () => {
    expect(likePattern("100%_off\\")).toBe("%100\\%\\_off\\\\%");
  });
});

describe("article body", () => {
  const HOSTILE = [
    `<script>alert(1)</script>`,
    `<img src="x" onerror="alert(1)">`,
    `<a href="javascript:alert(1)">click</a>`,
    `<a href="JaVaScRiPt:alert(1)">click</a>`,
    `<a href="data:text/html,<script>alert(1)</script>">data</a>`,
    `<iframe src="https://evil.example"></iframe>`,
    `<style>body{display:none}</style>`,
    `<svg onload="alert(1)"><circle /></svg>`,
    `<p style="background:url(javascript:alert(1))" onclick="alert(1)">styled</p>`,
    `<form action="https://evil.example"><input name="password"></form>`,
    `<object data="x"></object><embed src="x"><base href="https://evil.example">`,
  ].join("\n\n");

  function expectHarmless(rendered: string): void {
    expect(rendered).not.toMatch(/<script/i);
    expect(rendered).not.toMatch(/\son\w+\s*=/i);
    expect(rendered).not.toMatch(/javascript:/i);
    expect(rendered).not.toMatch(/data:text/i);
    expect(rendered).not.toMatch(/<(iframe|style|svg|form|input|object|embed|base)\b/i);
    expect(rendered).not.toMatch(/\sstyle\s*=/i);
    expect(rendered).not.toContain("alert(1)</script>");
  }

  it("removes active content from editor HTML", async () => {
    const rendered = await sanitizedArticleHtml(
      `<h2>Title</h2><p>Safe <strong>text</strong></p>${HOSTILE}`,
      "editor",
    );
    expectHarmless(rendered);
    expect(rendered).toContain("<h2>Title</h2>");
    expect(rendered).toContain("<strong>text</strong>");
  });

  it("removes active content from markdown, written as HTML or as markdown", async () => {
    const markdown = [
      "# Title",
      "Some **bold** text and a [link](https://example.com/page).",
      "[bad](javascript:alert(1)) ![img](javascript:alert(1))",
      '[quoted](https://example.com/"onmouseover="alert(1))',
      HOSTILE,
    ].join("\n\n");
    for (const method of ["upload", "web", "plugin", "something-new"]) {
      const rendered = await sanitizedArticleHtml(markdown, method);
      expectHarmless(rendered);
      expect(rendered).toContain("<h1>Title</h1>");
      expect(rendered).toContain("<strong>bold</strong>");
      expect(rendered).toContain('href="https://example.com/page"');
      expect(rendered).toContain('rel="noopener noreferrer"');
    }
  });

  it("treats editor content as HTML and other content as markdown", async () => {
    expect(await sanitizedArticleHtml("**bold**", "editor")).toBe("**bold**");
    expect((await sanitizedArticleHtml("**bold**", "upload")).trim()).toBe(
      "<p><strong>bold</strong></p>",
    );
    expect(await sanitizedArticleHtml("", "upload")).toBe("");
  });
  it("shows pathological markdown as text instead of blocking the server", async () => {
    const started = Date.now();
    const rendered = await sanitizedArticleHtml(
      `${"*".repeat(60000)}a <script>x</script>`,
      "upload",
    );
    expect(Date.now() - started).toBeLessThan(8000);
    expect(rendered).not.toMatch(/<script/i);
    expect(rendered.startsWith("<p>")).toBe(true);
  }, 15000);
});

describe("theme variables", () => {
  it("writes the accent, a readable colour on it, and the font stack", () => {
    const css = themeCss({
      ...DEFAULT_HELP_CENTER_THEME,
      accentColor: "#FFDD00",
      font: "serif",
    }).value;
    expect(css).toContain("--hc-accent:#ffdd00");
    expect(css).toContain("--hc-on-accent:#000000");
    expect(css).toContain("--hc-font:Charter");
    // Yellow is unreadable as link text on white, so links fall back to the text colour there.
    expect(css).toMatch(/--hc-link:#16181d.*prefers-color-scheme:dark.*--hc-link:#ffdd00/);
  });

  it("falls back to the defaults for anything that is not a colour or one of our values", () => {
    for (const accentColor of [
      "red;}</style><script>alert(1)</script>",
      "#fff",
      "#12345g",
      "#1234567",
      "url(https://evil.example/x)",
      "#2747d6;background:url(https://evil.example)",
    ]) {
      const bad = "x;}</style><script>" as never;
      const css = themeCss({
        accentColor,
        font: bad,
        colorScheme: bad,
        heroGradientFrom: accentColor,
        heroGradientTo: bad,
        heroGradientDirection: bad,
        heroOverlay: bad,
      }).value;
      expect(css).toBe(themeCss(DEFAULT_HELP_CENTER_THEME).value);
      expect(css).not.toContain("<");
      expect(css).not.toContain("evil");
    }
    expect(themeCss({ accentColor: 7 as unknown as string }).value).toBe(
      themeCss(DEFAULT_HELP_CENTER_THEME).value,
    );
  });

  it("picks black or white by contrast", () => {
    expect(readableTextOn("#ffffff")).toBe("#000000");
    expect(readableTextOn("#000000")).toBe("#ffffff");
    expect(readableTextOn("#2747d6")).toBe("#ffffff");
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    // On a gradient the text must read on both stops: the worse stop decides.
    expect(readableTextOn("#2747d6", "#7c3aed")).toBe("#ffffff");
    // Black on the navy stop alone would be 2.4:1; white is the better worst case.
    expect(readableTextOn("#9ca3af", "#1e3a8a")).toBe("#ffffff");
    expect(readableTextOn("#fde68a", "#f472b6")).toBe("#000000");
  });

  it("writes the gradient stops, their direction, a text colour for both, and the overlay", () => {
    const css = themeCss({
      ...DEFAULT_HELP_CENTER_THEME,
      heroGradientFrom: "#0B1026",
      heroGradientTo: "#312e81",
      heroGradientDirection: "down",
      heroOverlay: "strong",
    }).value;
    expect(css).toContain("--hc-hero-from:#0b1026;--hc-hero-to:#312e81;--hc-hero-angle:180deg");
    expect(css).toContain("--hc-on-gradient:#ffffff");
    expect(css).toContain("--hc-hero-overlay:0.75");
  });

  it("uses the link colour of a forced colour scheme only", () => {
    const accent = "#60a5fa"; // readable on dark, not on white
    const dark = themeCss({
      ...DEFAULT_HELP_CENTER_THEME,
      accentColor: accent,
      colorScheme: "dark",
    }).value;
    expect(dark).toContain(`--hc-link:${accent}`);
    expect(dark).not.toContain("prefers-color-scheme");
    const light = themeCss({
      ...DEFAULT_HELP_CENTER_THEME,
      accentColor: accent,
      colorScheme: "light",
    }).value;
    expect(light).toContain("--hc-link:#16181d");
    expect(light).not.toContain("prefers-color-scheme");
    // The stylesheet has a palette for each forced scheme.
    expect(SITE_CSS).toMatch(/\.hc-scheme-dark \{ color-scheme: dark; --hc-bg: #0f1115;/);
    expect(SITE_CSS).toMatch(/\.hc-scheme-light \{ color-scheme: light; --hc-bg: #ffffff;/);
  });

  it("names body and hero classes from the theme, and only ever ours", () => {
    expect(bodyClass({ colorScheme: "dark", corners: "pill" })).toBe(
      "hc-scheme-dark hc-corners-pill",
    );
    expect(heroClass({ heroStyle: "gradient", heroAlign: "left" }, false)).toBe(
      "hc-hero hc-hero-gradient hc-hero-left",
    );
    // An image hero without an image shows the accent colour.
    expect(heroClass({ heroStyle: "image", heroAlign: "center" }, false)).toBe(
      "hc-hero hc-hero-solid hc-hero-center",
    );
    expect(heroClass({ heroStyle: "image", heroAlign: "center" }, true)).toContain("hc-hero-image");
    const hostile = '"><script>alert(1)</script>' as never;
    expect(bodyClass({ colorScheme: hostile, corners: hostile })).toBe(
      "hc-scheme-auto hc-corners-rounded",
    );
    expect(heroClass({ heroStyle: hostile, heroAlign: hostile }, true)).toBe(
      "hc-hero hc-hero-solid hc-hero-center",
    );
  });

  it("names the stylesheet after its content", () => {
    expect(SITE_CSS_PATH).toMatch(/^\/_hc\/site\.[0-9a-f]{12}\.css$/);
  });
});

describe("robots.txt and sitemap.xml", () => {
  it("keeps crawlers out when the site must not be indexed", () => {
    expect(buildRobotsTxt(null)).toBe("User-agent: *\nDisallow: /\n");
  });

  it("allows crawling and points at the sitemap otherwise", () => {
    const robots = buildRobotsTxt("https://acme.haychat.co");
    expect(robots).toContain("Allow: /\n");
    expect(robots).toContain("Sitemap: https://acme.haychat.co/sitemap.xml");
    expect(robots).not.toMatch(/^Disallow: \/$/m);
  });

  it("lists the home page, collections and articles with escaped addresses", () => {
    const xml = buildSitemapXml("https://help.acme.com", [
      {
        id: "11111111-0000-4000-8000-000000000000",
        title: "Billing <&> plans",
        description: null,
        icon: null,
        articles: [
          {
            id: ID,
            title: "Refunds",
            description: null,
            updatedAt: new Date("2026-01-02T03:04:05Z"),
          },
        ],
      },
    ]);
    expect(xml).toContain("<loc>https://help.acme.com/</loc>");
    expect(xml).toContain("<loc>https://help.acme.com/collections/billing-plans-11111111</loc>");
    expect(xml).toContain(
      "<url><loc>https://help.acme.com/articles/refunds-0a1b2c3d</loc><lastmod>2026-01-02T03:04:05.000Z</lastmod></url>",
    );
    expect(xml.match(/<url>/g)).toHaveLength(3);
    expect(buildSitemapXml("https://x.test/?a=1&b=<2>", [])).toContain(
      "<loc>https://x.test/?a=1&amp;b=&lt;2&gt;/</loc>",
    );
  });

  it("dates a collection by its newest article and the home page by the newest of all", () => {
    const summary = (id: string, updatedAt: string) => ({
      id,
      title: id,
      description: null,
      updatedAt: new Date(updatedAt),
    });
    const collection = (id: string, articles: ReturnType<typeof summary>[]) => ({
      id,
      title: "c",
      description: null,
      icon: null,
      articles,
    });
    const xml = buildSitemapXml("https://h.test", [
      collection("11111111-0000-4000-8000-000000000000", [
        summary("aaaaaaaa-0000-4000-8000-000000000000", "2026-03-01T00:00:00Z"),
        summary("bbbbbbbb-0000-4000-8000-000000000000", "2026-05-01T00:00:00Z"),
      ]),
      collection("22222222-0000-4000-8000-000000000000", [
        summary("cccccccc-0000-4000-8000-000000000000", "2026-04-01T00:00:00Z"),
      ]),
    ]);
    const lastmod = (loc: string) =>
      new RegExp(`<loc>${loc}</loc><lastmod>([^<]+)</lastmod>`).exec(xml)?.[1];
    expect(lastmod("https://h.test/")).toBe("2026-05-01T00:00:00.000Z");
    expect(lastmod("https://h.test/collections/c-11111111")).toBe("2026-05-01T00:00:00.000Z");
    expect(lastmod("https://h.test/collections/c-22222222")).toBe("2026-04-01T00:00:00.000Z");
    expect(buildSitemapXml("https://h.test", [])).toContain(
      "<url><loc>https://h.test/</loc></url>",
    );
  });
});

describe("prepareForPage", () => {
  it("moves every heading down a level when the body has a level-1 heading", () => {
    expect(
      prepareForPage('<h1 id="a">A</h1><p>x</p><h2>B</h2><h3>C</h3><h6>D</h6><header>h</header>'),
    ).toBe('<h2 id="a">A</h2><p>x</p><h3>B</h3><h4>C</h4><h6>D</h6><header>h</header>');
  });

  it("leaves headings alone when the body starts at level 2", () => {
    expect(prepareForPage("<h2>B</h2><h3>C</h3>")).toBe("<h2>B</h2><h3>C</h3>");
  });

  it("decodes images asynchronously and lazy-loads all but the first", () => {
    expect(prepareForPage('<p><img src="a.png" alt=""></p><img src="b.png"><img/>')).toBe(
      '<p><img decoding="async" src="a.png" alt=""></p>' +
        '<img loading="lazy" decoding="async" src="b.png">' +
        '<img loading="lazy" decoding="async"/>',
    );
    expect(prepareForPage("<p>an &lt;img&gt; tag</p>")).toBe("<p>an &lt;img&gt; tag</p>");
  });
});

describe("pages", () => {
  const view = (overrides: Partial<SiteView> = {}): SiteView => ({
    name: "Acme <Help>",
    language: "pt",
    canonicalBase: "https://acme.haychat.co",
    theme: { ...DEFAULT_HELP_CENTER_THEME },
    logoUrl: null,
    socialImageUrl: null,
    heroImageUrl: null,
    noindex: false,
    nonce: "Tm9uY2U=",
    preview: null,
    webchat: null,
    ...overrides,
  });
  const collections = [
    {
      id: "11111111-0000-4000-8000-000000000000",
      title: "Billing",
      description: 'All about <b>money</b> "now"',
      icon: "💳",
      articles: [{ id: ID, title: "Refunds <fast>", description: null, updatedAt: new Date() }],
    },
  ];
  const article = {
    id: ID,
    title: "Refunds </title><script>alert(1)</script>",
    description: 'How "refunds" work',
    createdAt: new Date("2026-01-02T03:04:05.000Z"),
    updatedAt: new Date("2026-02-03T04:05:06.000Z"),
    content: "",
    importMethod: "editor",
    collection: { id: collections[0].id, title: "Billing" },
  };

  it("renders the home page as cards with escaped text, the language and a canonical link", () => {
    const page = renderHomePage(view(), collections);
    expect(page).toMatch(/^<!doctype html>\s*<html lang="pt">/);
    expect(page).toContain('<link rel="canonical" href="https://acme.haychat.co/" />');
    expect(page).toContain("Acme &lt;Help&gt;");
    expect(page).not.toContain("<Help>");
    expect(page).toContain("All about &lt;b&gt;money&lt;/b&gt; &quot;now&quot;");
    expect(page).toContain('href="/collections/billing-11111111"');
    expect(page).toContain("1 artigo");
    expect(page).not.toContain("Refunds");
    expect(page).not.toContain('name="robots"');
    expect(page).toContain(SITE_CSS_PATH);
    expect(page).toContain('<style nonce="Tm9uY2U=">');
    expect(page).toContain("Com tecnologia Hay");
    expect(page).not.toContain("HayChat");
  });

  it("lists every article on the home page in the list layout, and can hide the footer link", () => {
    const page = renderHomePage(
      view({ theme: { ...DEFAULT_HELP_CENTER_THEME, layout: "list", showPoweredBy: false } }),
      collections,
    );
    expect(page).toContain('href="/articles/refunds-fast-0a1b2c3d"');
    expect(page).toContain("Refunds &lt;fast&gt;");
    expect(page).not.toContain("hc-footer");
  });

  it("uses the hero text from the theme, escaped", () => {
    const page = renderHomePage(
      view({
        theme: { ...DEFAULT_HELP_CENTER_THEME, heroTitle: "Hi <there>", heroSubtitle: 'Ask "us"' },
      }),
      [],
    );
    expect(page).toContain("Hi &lt;there&gt;");
    expect(page).toContain('<meta name="description" content="Ask &quot;us&quot;" />');
  });

  it("puts the scheme and corner classes on the body and the hero style on the hero", () => {
    const page = renderHomePage(
      view({
        theme: {
          ...DEFAULT_HELP_CENTER_THEME,
          colorScheme: "dark",
          corners: "sharp",
          heroStyle: "plain",
          heroAlign: "left",
        },
      }),
      collections,
    );
    expect(page).toContain('<body class="hc-scheme-dark hc-corners-sharp">');
    expect(page).toContain('<section class="hc-hero hc-hero-plain hc-hero-left">');
    expect(page).not.toContain("hc-hero-bg");
    const articlePage = renderArticlePage(view(), article, raw(""));
    expect(articlePage).toContain('<body class="hc-scheme-auto hc-corners-rounded">');
  });

  it("shows the hero image, escaped, only when the hero style is image", () => {
    const heroImageUrl = 'https://cdn.hay.test/hero.jpg?a=1&b="x"';
    const imageTheme = { ...DEFAULT_HELP_CENTER_THEME, heroStyle: "image" as const };
    const page = renderHomePage(view({ theme: imageTheme, heroImageUrl }), []);
    expect(page).toContain('<section class="hc-hero hc-hero-image hc-hero-center">');
    expect(page).toContain(
      '<img class="hc-hero-bg" src="https://cdn.hay.test/hero.jpg?a=1&amp;b=&quot;x&quot;" alt=""',
    );
    expect(renderHomePage(view({ heroImageUrl }), [])).not.toContain("hc-hero-bg");
    const missing = renderHomePage(view({ theme: imageTheme }), []);
    expect(missing).toContain("hc-hero-solid");
    expect(missing).not.toContain("hc-hero-bg");
  });

  it("renders an article with its body untouched and everything else escaped", () => {
    const page = renderArticlePage(view(), article, raw("<p>Body <strong>here</strong></p>"));
    expect(page).toContain("<p>Body <strong>here</strong></p>");
    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toContain("Refunds &lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(page).toContain('<meta name="description" content="How &quot;refunds&quot; work" />');
    expect(page).toContain(
      '<link rel="canonical" href="https://acme.haychat.co/articles/refunds-title-script-alert-1-script-0a1b2c3d" />',
    );
    expect(page).toContain(`data-hc-feedback="${ID}"`);
    expect(page).not.toMatch(/<section[^>]*data-hc-preview/);
    expect(page).toContain("Isto foi útil?");
    // No chat widget, so no promise of one.
    expect(page).not.toContain("Ainda precisa de ajuda?");
    expect(page.match(/<script nonce="Tm9uY2U=">/g)).toHaveLength(1);
  });

  it("embeds the chat widget with the article as context", () => {
    const page = renderArticlePage(
      view({ webchat: { organizationId: "org-1", baseUrl: "https://api.hay.test" } }),
      article,
      raw(""),
    );
    expect(page).toContain("Ainda precisa de ajuda?");
    expect(page).toContain('src="https://api.hay.test/v1/webchat/widget.js"');
    const config = /window\.HayChat\.config = (.*);/.exec(page)?.[1] ?? "";
    expect(config).not.toContain("<");
    expect(JSON.parse(config)).toEqual({
      organizationId: "org-1",
      baseUrl: "https://api.hay.test",
      context: {
        helpCenterArticleTitle: article.title,
        helpCenterArticleUrl:
          "https://acme.haychat.co/articles/refunds-title-script-alert-1-script-0a1b2c3d",
      },
    });
    expect(page.match(/<script\s+nonce="Tm9uY2U="/g)).toHaveLength(3);
    // Every executable script carries the nonce; JSON-LD blocks are data and are never run.
    expect(page.match(/<script(?! type="application\/ld\+json")/g)).toHaveLength(3);
  });

  it("keeps preview parameters on every link and form, and is never indexed", () => {
    const preview = { token: "123.sig&x", theme: "eyJ9" };
    const page = renderHomePage(view({ preview, noindex: true }), collections);
    expect(page).toContain(
      'href="/collections/billing-11111111?hc_preview=123.sig%26x&amp;hc_theme=eyJ9"',
    );
    expect(page).toContain('<input type="hidden" name="hc_preview" value="123.sig&amp;x" />');
    expect(page).toContain('<input type="hidden" name="hc_theme" value="eyJ9" />');
    expect(page).toContain('<meta name="robots" content="noindex" />');
    // The canonical address never carries them.
    expect(page).toContain('<link rel="canonical" href="https://acme.haychat.co/" />');
    const hrefs = [...page.matchAll(/href="(\/[^"_][^"]*|\/)"/g)].map((match) => match[1]);
    expect(hrefs.length).toBeGreaterThan(1);
    for (const href of hrefs) expect(href).toContain("hc_preview=");
    expect(renderArticlePage(view({ preview }), article, raw(""))).toMatch(
      /<section[^>]*data-hc-preview/,
    );
  });

  it("shows the query back escaped on the search page and never indexes it", () => {
    const page = renderSearchPage(view(), '"><script>alert(1)</script>', []);
    expect(page).not.toContain("<script>alert(1)");
    expect(page).toContain('value="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(page).toContain("Sem resultados");
    expect(page).toContain('<meta name="robots" content="noindex" />');
    expect(page).not.toContain('rel="canonical"');
  });

  it("renders a bare 404 page for a host with no site", () => {
    const page = renderNotFoundPage(view({ name: "", language: "xx<", noindex: true }));
    expect(page).toMatch(/^<!doctype html>\s*<html lang="en">/);
    expect(page).toContain("Page not found");
    expect(page).not.toContain("hc-brand");
    expect(page).not.toContain("Back to home");
  });

  describe("head metadata", () => {
    const meta = (page: string, key: string) =>
      new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)" />`).exec(page)?.[1];

    it("describes a page for link previews with escaped values", () => {
      const page = renderArticlePage(
        view({ socialImageUrl: "https://cdn.test/logo.png?a=1&b=2" }),
        article,
        raw("<p>Body</p>"),
      );
      expect(meta(page, "og:type")).toBe("article");
      expect(meta(page, "og:site_name")).toBe("Acme &lt;Help&gt;");
      expect(meta(page, "og:title")).toBe(
        "Refunds &lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;",
      );
      expect(meta(page, "og:description")).toBe("How &quot;refunds&quot; work");
      expect(meta(page, "og:url")).toBe(
        "https://acme.haychat.co/articles/refunds-title-script-alert-1-script-0a1b2c3d",
      );
      expect(meta(page, "og:locale")).toBe("pt");
      expect(meta(page, "og:image")).toBe("https://cdn.test/logo.png?a=1&amp;b=2");
      expect(meta(page, "twitter:card")).toBe("summary");
      expect(meta(renderHomePage(view({ language: "pt-BR" }), []), "og:locale")).toBe("pt_BR");
      expect(meta(renderHomePage(view(), []), "og:type")).toBe("website");
    });

    it("leaves out an image that is not an absolute http address", () => {
      for (const socialImageUrl of [null, "/uploads/logo.png", "javascript:alert(1)"]) {
        expect(renderHomePage(view({ socialImageUrl }), [])).not.toContain("og:image");
      }
    });

    it("has no link preview tags on pages without a canonical address", () => {
      expect(renderSearchPage(view(), "x", [])).not.toContain("og:");
      expect(renderNotFoundPage(view())).not.toContain("og:");
      expect(renderNotFoundPage(view())).not.toContain("twitter:");
    });

    it("falls back to the listed titles or the article text for a description", () => {
      expect(meta(renderHomePage(view(), collections), "description")).toBe("Billing");
      const untitled = { ...collections[0], description: null };
      expect(meta(renderCollectionPage(view(), untitled), "description")).toBe(
        "Refunds &lt;fast&gt;",
      );
      const body = raw(
        `<h2>Steps</h2><p>Go to <b>Billing</b> &amp; pick &quot;Refund&quot;. ${"Then wait. ".repeat(30)}</p>`,
      );
      const description =
        meta(renderArticlePage(view(), { ...article, description: null }, body), "description") ??
        "";
      expect(description).toMatch(
        /^Steps Go to Billing &amp; pick &quot;Refund&quot;\. Then wait\./,
      );
      expect(description.endsWith("…")).toBe(true);
      expect(description.replace(/&[a-z]+;/g, "x").length).toBeLessThanOrEqual(160);
    });

    it("sets the theme colour, icons, and a preconnect to the widget's host", () => {
      const page = renderHomePage(
        view({
          logoUrl: "https://cdn.test/logo.png",
          theme: { ...DEFAULT_HELP_CENTER_THEME, accentColor: "#123abc" },
          webchat: { organizationId: "org-1", baseUrl: "https://api.hay.test" },
        }),
        [],
      );
      expect(meta(page, "theme-color")).toBe("#123abc");
      expect(page).toContain('<link rel="icon" href="https://cdn.test/logo.png" />');
      expect(page).toContain('<link rel="apple-touch-icon" href="https://cdn.test/logo.png" />');
      expect(page).toContain('<link rel="preconnect" href="https://api.hay.test" />');

      const plain = renderHomePage(
        view({ theme: { ...DEFAULT_HELP_CENTER_THEME, accentColor: "red;}" } }),
        [],
      );
      expect(plain).not.toContain("theme-color");
      expect(plain).not.toContain("apple-touch-icon");
      expect(plain).not.toContain("preconnect");
    });
  });

  describe("structured data", () => {
    /** Every JSON-LD block of a page, parsed. */
    const structuredData = (page: string): Array<Record<string, unknown>> =>
      [...page.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(
        (match) => JSON.parse(match[1]) as Record<string, unknown>,
      );
    const ofType = (page: string, type: string) =>
      structuredData(page).filter((data) => data["@type"] === type);

    it("describes the site and its search on the home page", () => {
      const page = renderHomePage(view(), collections);
      expect(structuredData(page)).toEqual([
        {
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Acme <Help>",
          url: "https://acme.haychat.co/",
          inLanguage: "pt",
          potentialAction: {
            "@type": "SearchAction",
            target: {
              "@type": "EntryPoint",
              urlTemplate: "https://acme.haychat.co/search?q={search_term_string}",
            },
            "query-input": "required name=search_term_string",
          },
        },
      ]);
      // Text in a data block cannot close the script element.
      expect(page).not.toContain('"Acme <Help>"');
    });

    it("gives a collection its breadcrumb trail", () => {
      const [trail] = ofType(renderCollectionPage(view(), collections[0]), "BreadcrumbList");
      expect(trail.itemListElement).toEqual([
        { "@type": "ListItem", position: 1, name: "Acme <Help>", item: "https://acme.haychat.co/" },
        {
          "@type": "ListItem",
          position: 2,
          name: "Billing",
          item: "https://acme.haychat.co/collections/billing-11111111",
        },
      ]);
    });

    it("describes an article with its dates, publisher and breadcrumb trail", () => {
      const page = renderArticlePage(
        view({ socialImageUrl: "https://cdn.test/logo.png" }),
        article,
        raw("<p>Body</p>"),
      );
      expect(page).not.toContain("<script>alert(1)</script>");
      const url = "https://acme.haychat.co/articles/refunds-title-script-alert-1-script-0a1b2c3d";
      const publisher = {
        "@type": "Organization",
        name: "Acme <Help>",
        url: "https://acme.haychat.co/",
        logo: "https://cdn.test/logo.png",
      };
      expect(ofType(page, "Article")).toEqual([
        {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: article.title,
          description: 'How "refunds" work',
          url,
          mainEntityOfPage: url,
          inLanguage: "pt",
          datePublished: "2026-01-02T03:04:05.000Z",
          dateModified: "2026-02-03T04:05:06.000Z",
          image: "https://cdn.test/logo.png",
          author: publisher,
          publisher,
        },
      ]);
      const [trail] = ofType(page, "BreadcrumbList");
      expect(trail.itemListElement).toHaveLength(3);
      expect((trail.itemListElement as Array<{ item: string }>)[2].item).toBe(url);
    });

    it("cuts a long headline and leaves out an image there is none of", () => {
      const long = { ...article, title: "word ".repeat(40), description: null };
      const [data] = ofType(renderArticlePage(view(), long, raw("")), "Article");
      expect(String(data.headline).length).toBeLessThanOrEqual(110);
      expect(data).not.toHaveProperty("image");
      expect(data).not.toHaveProperty("description");
      expect(data.publisher).not.toHaveProperty("logo");
    });

    it("is left off search and 404 pages", () => {
      expect(structuredData(renderSearchPage(view(), "x", []))).toEqual([]);
      expect(structuredData(renderNotFoundPage(view()))).toEqual([]);
    });
  });

  it("falls back to English labels and a valid lang attribute", () => {
    expect(siteStrings("pt-BR").yes).toBe("Sim");
    expect(siteStrings("es").search).toBe("Buscar");
    expect(siteStrings("ja").search).toBe("Search");
    expect(siteStrings(null).articleCount(2)).toBe("2 articles");
    expect(htmlLang("pt-BR")).toBe("pt-BR");
    expect(htmlLang('en"><script>')).toBe("en");
  });
});
