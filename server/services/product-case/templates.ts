/**
 * Ready-made playbooks merchants can start from (D8-14). A template only
 * fills the "new playbook" form: it is created as a draft the merchant edits
 * and activates.
 *
 * Copy must never claim more than the code does: refunds and replacements go
 * through the store's tools and approval settings, so the AI is told never to
 * confirm one before the tool result says it went through.
 *
 * @module services/product-case/templates
 */

export type TemplateLocale = "en" | "pt-BR";

export interface PlaybookTemplate {
  id: string;
  title: string;
  trigger: string;
  description: string;
  /** Markdown; the dashboard turns it into the editor's document. */
  instructions: string;
}

const PRODUCT_PROBLEM: Record<TemplateLocale, PlaybookTemplate> = {
  en: {
    id: "product-problem",
    title: "Product problem intake",
    trigger:
      "The customer reports a problem with a product they received: defective, damaged, contaminated, wrong item, or a bad reaction after using it",
    description:
      "Collects photos, the lot number, the invoice, how the product was used and a timeline, then sends the complete case to your team.",
    instructions: `## Safety first
- Never give medical, health or dosage advice, and never say whether a product is safe to use or keep using.
- If the customer mentions an injury, an allergic reaction or feeling unwell, tell them to stop using the product and to contact a doctor or the emergency services, then carry on collecting the case.
- Don't admit fault or promise an outcome before the team reviews the case.

## Collect the evidence
Ask for one or two items at a time, in the customer's language, and skip anything they have already sent:
1. Photos of the problem and of the product. You can read photos; use inspect_attachment to check a detail.
2. The lot or batch number printed on the label or package (a photo of it works).
3. The invoice, receipt or nota fiscal (photo or PDF), or the order or invoice number.
4. How the product was used and stored.
5. The timeline: when it was bought, first used, and when the problem started.

Photos of ID documents and payment cards are hidden from you. Never ask for card details.

## When everything is in
Call complete_product_case with a short summary, the product, how it was used and the timeline. If it lists missing items, ask the customer for them. When it confirms, tell the customer the case is complete and the team will review it.

## Refund or replacement
If the photos clearly show damage, you may offer a refund or a replacement using the store's tools. Never tell the customer a refund or replacement is confirmed until the tool result says it went through.`,
  },
  "pt-BR": {
    id: "product-problem",
    title: "Registro de problema com produto",
    trigger:
      "O cliente relata um problema com um produto que recebeu: defeito, avaria, contaminação, item errado ou uma reação ruim depois de usar",
    description:
      "Reúne fotos, o número do lote, a nota fiscal, como o produto foi usado e a linha do tempo, e envia o caso completo para a sua equipe.",
    instructions: `## Segurança em primeiro lugar
- Nunca dê orientação médica, de saúde ou de dosagem, e nunca diga se um produto é seguro para usar ou continuar usando.
- Se o cliente mencionar um ferimento, uma reação alérgica ou mal-estar, diga para parar de usar o produto e procurar um médico ou o serviço de emergência, e continue registrando o caso.
- Não admita culpa nem prometa um resultado antes de a equipe analisar o caso.

## Reúna as evidências
Peça um ou dois itens por vez, no idioma do cliente, e pule o que ele já enviou:
1. Fotos do problema e do produto. Você consegue ler fotos; use inspect_attachment para conferir um detalhe.
2. O número do lote impresso no rótulo ou na embalagem (uma foto serve).
3. A nota fiscal ou o comprovante (foto ou PDF), ou o número do pedido ou da nota.
4. Como o produto foi usado e guardado.
5. A linha do tempo: quando foi comprado, quando foi usado pela primeira vez e quando o problema começou.

Fotos de documentos de identidade e de cartões de pagamento ficam ocultas para você. Nunca peça dados de cartão.

## Quando tiver tudo
Chame complete_product_case com um resumo curto, o produto, como foi usado e a linha do tempo. Se ele listar itens faltando, peça ao cliente. Quando confirmar, diga ao cliente que o caso está completo e que a equipe vai analisá-lo.

## Reembolso ou troca
Se as fotos mostrarem claramente a avaria, você pode oferecer reembolso ou troca usando as ferramentas da loja. Nunca diga ao cliente que um reembolso ou troca está confirmado antes de o resultado da ferramenta dizer que foi concluído.`,
  },
};

export function listPlaybookTemplates(locale: TemplateLocale): PlaybookTemplate[] {
  return [PRODUCT_PROBLEM[locale] ?? PRODUCT_PROBLEM.en];
}
