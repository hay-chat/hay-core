import { TemplateService } from "../../services/template.service";

// The shared notification template (alerts, digests, disputes, channel health)
// lost every {{#if}} block when translations were substituted first, and loop
// items ({{ this.label }}) and nested paths ({{ actionButton.url }}) never resolved.
describe("TemplateService.render (notification)", () => {
  const service = new TemplateService();
  beforeAll(() => service.initialize());

  const render = (variables: Record<string, unknown>, locale = "en") =>
    service.render({ template: "notification", variables, locale });

  it("keeps conditional blocks, loop items and nested values", async () => {
    const { html } = await render({
      userName: "Ana",
      notificationTitle: "A shopper is waiting",
      notificationMessage: "Please reply.",
      details: [{ label: "Order", value: "#1001" }],
      relatedItems: [{ text: "Conversation", url: "https://hay.chat/c/1" }],
      actionButton: { url: "https://hay.chat/inbox", text: "Open inbox" },
    });

    expect(html).toContain("Hi Ana,");
    expect(html).toContain("<strong>Order:</strong> #1001");
    expect(html).toContain('href="https://hay.chat/c/1"');
    expect(html).toContain('href="https://hay.chat/inbox"');
    expect(html).toContain("Open inbox");
    expect(html).not.toContain("{{");
  });

  it("uses the {{else}} branch for the title padding when there is no icon", async () => {
    const withIcon = await render({ notificationTitle: "T", notificationIcon: "!" });
    const withoutIcon = await render({ notificationTitle: "T" });

    expect(withIcon.html).toContain("padding:10px 25px 20px 25px");
    expect(withoutIcon.html).not.toContain("padding:10px 25px 20px 25px");
    expect(withoutIcon.html).not.toContain("{{else}}");
  });

  it("translates and HTML-escapes variable values", async () => {
    const { html } = await render(
      {
        notificationTitle: "T",
        details: [{ label: "Resumo", value: "<img src=x onerror=alert(1)>" }],
      },
      "pt",
    );

    expect(html).toContain("Detalhes");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
  });
});
