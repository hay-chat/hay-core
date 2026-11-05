/**
 * Questions customers commonly ask, per business type, for in-app setup.
 *
 * A question is answered from the organization's documents unless it declares `needs`, a thing
 * only a connected platform can do. The catalog never names a plugin: plugins declare which
 * `needs` they handle in their manifest. Text is copied onto the organization when it picks
 * the question, so people can edit it afterwards; ids stay stable.
 *
 * @module services/setup/catalog
 */

import type { BusinessType, SetupHandle } from "@server/types/setup.types";

export type CatalogLocale = "en" | "pt-BR";

export interface CatalogQuestion {
  /** Stable, prefixed by business type so ids never collide across types. */
  id: string;
  text: Record<CatalogLocale, string>;
  needs?: SetupHandle;
}

const q = (id: string, en: string, ptBR: string, needs?: SetupHandle): CatalogQuestion => ({
  id,
  text: { en, "pt-BR": ptBR },
  ...(needs ? { needs } : {}),
});

/** Deepest list: online stores get the most questions. */
const STORE: CatalogQuestion[] = [
  q("store.returns", "What is your return policy?", "Qual é a política de troca e devolução?"),
  q("store.order_status", "Where is my order?", "Onde está o meu pedido?", "orders"),
  q("store.shipping_time", "How long does shipping take?", "Quanto tempo leva a entrega?"),
  q("store.shipping_cost", "How much is shipping?", "Quanto custa o frete?"),
  q("store.shipping_countries", "Do you ship to my country?", "Vocês entregam no meu país?"),
  q("store.refund", "I want a refund", "Quero um reembolso", "refunds"),
  q(
    "store.change_address",
    "Can I change my delivery address?",
    "Posso alterar o endereço de entrega?",
    "order_changes",
  ),
  q(
    "store.cancel_order",
    "Can I cancel my order?",
    "Posso cancelar o meu pedido?",
    "order_changes",
  ),
  q(
    "store.wrong_item",
    "I received the wrong or a damaged item. What do I do?",
    "Recebi o item errado ou danificado. O que faço?",
  ),
  q(
    "store.payment_methods",
    "Which payment methods do you accept?",
    "Quais formas de pagamento vocês aceitam?",
  ),
  q(
    "store.discounts",
    "Do you have any discount codes or promotions?",
    "Vocês têm cupons de desconto ou promoções?",
  ),
  q("store.stock", "Is this product back in stock?", "Este produto vai voltar ao estoque?"),
  q(
    "store.product_care",
    "How do I care for or use the product?",
    "Como devo cuidar ou usar o produto?",
  ),
  q("store.warranty", "Does the product have a warranty?", "O produto tem garantia?"),
  q("store.contact", "How can I contact you?", "Como posso falar com vocês?"),
];

const SAAS: CatalogQuestion[] = [
  q("saas.pricing", "How much does it cost?", "Quanto custa?"),
  q("saas.trial", "Is there a free trial?", "Existe um período de teste gratuito?"),
  q("saas.invite_team", "How do I invite my team?", "Como convido minha equipe?"),
  q(
    "saas.integrations",
    "Which tools do you integrate with?",
    "Com quais ferramentas vocês se integram?",
  ),
  q("saas.invoice", "Can I get my invoice?", "Posso receber minha fatura?", "billing"),
  q("saas.cancel", "How do I cancel my plan?", "Como cancelo meu plano?", "subscriptions"),
  q("saas.refund_policy", "Do you offer refunds?", "Vocês oferecem reembolso?"),
  q(
    "saas.security",
    "How do you handle security and my data?",
    "Como vocês cuidam da segurança e dos meus dados?",
  ),
  q("saas.support", "How do I reach support?", "Como falo com o suporte?"),
];

const SERVICE: CatalogQuestion[] = [
  q("service.hours", "What are your opening hours?", "Qual é o horário de funcionamento?"),
  q("service.price", "How much do you charge?", "Quanto vocês cobram?"),
  q("service.book", "Can I book an appointment?", "Posso agendar um horário?", "bookings"),
  q("service.reschedule", "I need to reschedule", "Preciso remarcar", "bookings"),
  q("service.area", "Do you cover my area?", "Vocês atendem a minha região?"),
  q(
    "service.cancellation_policy",
    "What is your cancellation policy?",
    "Qual é a política de cancelamento?",
  ),
  q(
    "service.payment_methods",
    "Which payment methods do you accept?",
    "Quais formas de pagamento vocês aceitam?",
  ),
];

const OTHER: CatalogQuestion[] = [
  q("other.contact", "How can I contact you?", "Como posso falar com vocês?"),
  q("other.offer", "What do you offer?", "O que vocês oferecem?"),
  q("other.pricing", "How much does it cost?", "Quanto custa?"),
  q("other.hours", "What are your opening hours?", "Qual é o horário de funcionamento?"),
  q("other.human", "Can I talk to a person?", "Posso falar com uma pessoa?"),
];

const CATALOG: Record<BusinessType, CatalogQuestion[]> = {
  store: STORE,
  saas: SAAS,
  service: SERVICE,
  other: OTHER,
};

/** The org's language picks the list; anything not Portuguese falls back to English. */
export function catalogLocale(language: string | null | undefined): CatalogLocale {
  return language?.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}

export function catalogFor(
  businessType: BusinessType,
  language: string | null | undefined,
): { id: string; text: string; needs?: SetupHandle }[] {
  const locale = catalogLocale(language);
  return CATALOG[businessType].map((entry) => ({
    id: entry.id,
    text: entry.text[locale],
    ...(entry.needs ? { needs: entry.needs } : {}),
  }));
}

/** Catalog entry for an id, whatever its business type. */
export function findCatalogQuestion(id: string): CatalogQuestion | undefined {
  return Object.values(CATALOG)
    .flat()
    .find((entry) => entry.id === id);
}
