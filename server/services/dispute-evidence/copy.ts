/**
 * Copy for the dispute evidence PDF and ZIP README (D2-3 / D2-5), in the
 * conversation's language. en and pt-BR; anything else falls back to English.
 *
 * Guardrail: nothing here may say or imply that the file wins a dispute or
 * that any payment provider accepts it. Facts only.
 */

export type EvidenceLocale = "en" | "pt-BR";

export type EvidenceTemplate =
  | "generic"
  | "item_not_received"
  | "not_as_described"
  | "cancelled_credit";

export const EVIDENCE_TEMPLATES: readonly EvidenceTemplate[] = [
  "generic",
  "item_not_received",
  "not_as_described",
  "cancelled_credit",
];

export function evidenceLocale(language: string | null | undefined): EvidenceLocale {
  const base = (language ?? "").toLowerCase().split(/[-_]/)[0];
  return base === "pt" ? "pt-BR" : "en";
}

type Fill = Record<string, string | number>;

function fill(template: string, values: Fill = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

interface CopyTable {
  title: string;
  templates: Record<EvidenceTemplate, string>;
  cover: {
    store: string;
    order: string;
    platform: string;
    orderTotal: string;
    orderPlaced: string;
    customer: string;
    conversations: string;
    period: string;
    reason: string;
    generated: string;
    timeZone: string;
  };
  summaryHeading: string;
  summary: string;
  summaryNoMessages: string;
  keyFactsHeading: string;
  keyFactsNone: string;
  timelineHeading: string;
  timelineIntro: string;
  policiesHeading: string;
  policiesIntro: string;
  policyFirstShown: string;
  /** Under an excerpt read from the document today (no text recorded at the time). */
  policyCurrentText: string;
  /** Where the timeline stops at the page limit. */
  timelineTruncated: string;
  attachmentsHeading: string;
  attachmentsNone: string;
  imageOmitted: string;
  imageUnavailable: string;
  attachmentNotImage: string;
  conversationHeader: string;
  webChannel: string;
  author: { customer: string; ai: string; team: string };
  receipt: { sent: string; delivered: string; read: string; failed: string };
  channelReceiptNote: string;
  footer: string;
  cardRemoved: string;
  takeover: { started: string; startedNamed: string; ended: string; endedNamed: string };
  action: {
    refund: string;
    refundAmount: string;
    cancel: string;
    return: string;
    exchange: string;
    discount: string;
    addressChange: string;
    customerUpdate: string;
    other: string;
    reference: string;
    held: string;
    failed: string;
    failedWithReason: string;
    tracking: string;
    trackingCarrier: string;
    trackingNumber: string;
    trackingStatus: string;
    trackingDelivered: string;
  };
  noun: Record<
    "refund" | "cancel" | "return" | "exchange" | "discount" | "address_change" | "customer_update",
    string
  >;
  toolErrors: { codes: Record<string, string>; reasons: Record<string, string> };
  readme: string[];
}

const en: CopyTable = {
  title: "Customer communication record",
  templates: {
    generic: "General",
    item_not_received: "Item not received",
    not_as_described: "Item not as described or defective",
    cancelled_credit: "Cancelled order or credit not processed",
  },
  cover: {
    store: "Store",
    order: "Order",
    platform: "Platform",
    orderTotal: "Order total",
    orderPlaced: "Order placed",
    customer: "Customer",
    conversations: "Conversations",
    period: "Period",
    reason: "Prepared for",
    generated: "Generated",
    timeZone: "Times shown in",
  },
  summaryHeading: "Summary",
  summary:
    "This file contains {conversations} conversation(s) between {store} and the customer on {channels}, from {from} to {to}: {customerMessages} message(s) from the customer, {replies} reply(ies) from the store and {actions} recorded store action(s). Every entry was recorded by Hay.chat when it happened.",
  summaryNoMessages:
    "No customer-visible messages from these conversations are still stored. They may have been deleted under the store's data retention setting.",
  keyFactsHeading: "Key facts",
  keyFactsNone: "No store actions relevant to this reason were recorded.",
  timelineHeading: "Timeline",
  timelineIntro:
    "Messages the customer saw or sent, store actions and their results, and hand-offs to the store's team, in date order. Internal notes and system instructions are left out.",
  policiesHeading: "Store policies shown to the customer",
  policiesIntro:
    "Documents the store's AI assistant used when answering the customer. Each excerpt is the text as it was when the assistant used it, unless marked otherwise.",
  policyFirstShown: "First used in a reply: {at}",
  policyCurrentText:
    "This is the document as it is stored today: the text at the time was not recorded. It may have been edited since.",
  timelineTruncated:
    "{count} more timeline entries are not shown, to keep this file within {pages} pages. The full conversations stay available to the store in Hay.chat.",
  attachmentsHeading: "Attachments",
  attachmentsNone: "No attachments.",
  imageOmitted: "Image left out to keep this file under 4 MB. It is included in the ZIP download.",
  imageUnavailable: "Image no longer available.",
  attachmentNotImage: "File attached (not shown in this PDF): {name}",
  conversationHeader: "Conversation on {channel}, started {at}",
  webChannel: "website chat",
  author: { customer: "Customer", ai: "Store (AI assistant)", team: "Store (team member)" },
  receipt: {
    sent: "sent",
    delivered: "delivered to the customer",
    read: "read by the customer",
    failed: "not delivered",
  },
  channelReceiptNote: "Status reported by {channel}: {status}",
  footer: "Generated by Hay.chat on {at}. Page {page} of {pages}.",
  cardRemoved: "[card number removed]",
  takeover: {
    started: "A team member took over the conversation.",
    startedNamed: "{name} (team member) took over the conversation.",
    ended: "The team member handed the conversation back.",
    endedNamed: "{name} (team member) handed the conversation back.",
  },
  action: {
    refund: "Refund issued.",
    refundAmount: "Refund issued: {amount}.",
    cancel: "Order cancelled.",
    return: "Return opened.",
    exchange: "Exchange created.",
    discount: "Coupon or discount created.",
    addressChange: "Shipping address updated.",
    customerUpdate: "Customer details updated.",
    other: "Store action completed: {action}.",
    reference: "Reference: {id}.",
    held: "The AI assistant requested {noun}; it was sent to a team member for approval.",
    failed: "The AI assistant attempted {noun}, but it did not go through.",
    failedWithReason: "The AI assistant attempted {noun}, but it did not go through: {reason}",
    tracking: "Order tracking checked in the store:",
    trackingCarrier: "carrier {carrier}",
    trackingNumber: "tracking number {number}",
    trackingStatus: "status {status}",
    trackingDelivered: "delivered on {at}",
  },
  noun: {
    refund: "a refund",
    cancel: "an order cancellation",
    return: "a return",
    exchange: "an exchange",
    discount: "a coupon or discount",
    address_change: "a shipping address change",
    customer_update: "a change to the customer's details",
  },
  toolErrors: {
    codes: {
      NOT_FOUND: "the store could not find the order, customer or item.",
      PRECONDITION: "the order's state at the time did not allow it.",
      PROVIDER_REFUSED: "the store refused the request.",
      OUTCOME_UNKNOWN: "the store did not confirm whether it went through.",
      APPROVAL_REJECTED: "a team member declined the request.",
    },
    reasons: {
      EXCEEDS_REFUNDABLE: "the amount was more than what could still be refunded on this order.",
      CUSTOMER_MISMATCH: "the order does not belong to this customer.",
      ALREADY_CANCELLED: "the order was already cancelled.",
      ALREADY_SHIPPED: "the order had already shipped.",
      OUT_OF_STOCK: "the item was out of stock.",
      NOT_PAID: "the order had not been paid.",
      IDENTITY_MISMATCH: "the customer's details did not match the order.",
      FULFILLMENT_IN_PROGRESS: "the order was already being prepared for shipping.",
      EMAIL_MISMATCH: "the email given did not match the order.",
      ALREADY_REFUNDED: "this was already refunded.",
      PENDING_REFUND: "a refund was already in progress for this order.",
      NOT_RETURNABLE: "the item could not be returned.",
      NOT_REFUNDABLE: "the order could not be refunded.",
      NOT_PRE_DISPATCH: "the order had moved past the stage where it could still be changed.",
      FULLY_REFUNDED: "the order had already been fully refunded.",
      ALREADY_DISPATCHED: "the order had already been dispatched.",
    },
  },
  readme: [
    "Customer communication record",
    "",
    "Generated by Hay.chat on {at} for {store}.",
    "",
    "What this ZIP contains:",
    "- evidence.pdf: the conversation record (messages the customer saw or sent, store actions and their results, hand-offs to the store's team, delivery and read receipts where the channel reported them, and excerpts of store policies the AI assistant used).",
    "- attachments/: the files exchanged in these conversations that are still stored.",
    "- manifest.json: the SHA-256 hash of every file in this ZIP, so anyone can check that a file has not been changed since it was generated.",
    "- README.txt: this file.",
    "",
    "Where it comes from: every entry was recorded by Hay.chat when it happened. Internal notes, system instructions and AI reasoning are left out. Only data still stored under the store's data retention setting is included; anything deleted before {at} cannot be part of this record.",
    "",
    "This is a record of what happened, not legal advice. It does not guarantee any outcome, and no payment provider or bank has reviewed or approved it.",
  ],
};

const ptBR: CopyTable = {
  title: "Registro de comunicação com o cliente",
  templates: {
    generic: "Geral",
    item_not_received: "Produto não recebido",
    not_as_described: "Produto diferente do anunciado ou com defeito",
    cancelled_credit: "Pedido cancelado ou estorno não processado",
  },
  cover: {
    store: "Loja",
    order: "Pedido",
    platform: "Plataforma",
    orderTotal: "Total do pedido",
    orderPlaced: "Pedido feito em",
    customer: "Cliente",
    conversations: "Conversas",
    period: "Período",
    reason: "Preparado para",
    generated: "Gerado em",
    timeZone: "Horários em",
  },
  summaryHeading: "Resumo",
  summary:
    "Este arquivo contém {conversations} conversa(s) entre {store} e o cliente em {channels}, de {from} a {to}: {customerMessages} mensagem(ns) do cliente, {replies} resposta(s) da loja e {actions} ação(ões) da loja registradas. Cada item foi registrado pelo Hay.chat no momento em que aconteceu.",
  summaryNoMessages:
    "Nenhuma mensagem visível ao cliente destas conversas continua armazenada. Elas podem ter sido apagadas pela configuração de retenção de dados da loja.",
  keyFactsHeading: "Fatos principais",
  keyFactsNone: "Nenhuma ação da loja relacionada a este motivo foi registrada.",
  timelineHeading: "Linha do tempo",
  timelineIntro:
    "Mensagens que o cliente viu ou enviou, ações da loja e seus resultados, e transferências para a equipe da loja, em ordem de data. Notas internas e instruções do sistema ficam de fora.",
  policiesHeading: "Políticas da loja mostradas ao cliente",
  policiesIntro:
    "Documentos que o assistente de IA da loja usou ao responder o cliente. Cada trecho é o texto como estava quando o assistente o usou, salvo indicação em contrário.",
  policyFirstShown: "Usado pela primeira vez em uma resposta: {at}",
  policyCurrentText:
    "Este é o documento como está armazenado hoje: o texto da época não foi registrado. Ele pode ter sido editado desde então.",
  timelineTruncated:
    "Mais {count} itens da linha do tempo não aparecem aqui, para manter este arquivo em até {pages} páginas. As conversas completas continuam disponíveis para a loja no Hay.chat.",
  attachmentsHeading: "Anexos",
  attachmentsNone: "Nenhum anexo.",
  imageOmitted:
    "Imagem deixada de fora para manter este arquivo abaixo de 4 MB. Ela está incluída no download em ZIP.",
  imageUnavailable: "Imagem não está mais disponível.",
  attachmentNotImage: "Arquivo anexado (não mostrado neste PDF): {name}",
  conversationHeader: "Conversa em {channel}, iniciada em {at}",
  webChannel: "chat do site",
  author: { customer: "Cliente", ai: "Loja (assistente de IA)", team: "Loja (equipe)" },
  receipt: {
    sent: "enviada",
    delivered: "entregue ao cliente",
    read: "lida pelo cliente",
    failed: "não entregue",
  },
  channelReceiptNote: "Status informado por {channel}: {status}",
  footer: "Gerado pelo Hay.chat em {at}. Página {page} de {pages}.",
  cardRemoved: "[número de cartão removido]",
  takeover: {
    started: "Uma pessoa da equipe assumiu a conversa.",
    startedNamed: "{name} (equipe) assumiu a conversa.",
    ended: "A pessoa da equipe devolveu a conversa.",
    endedNamed: "{name} (equipe) devolveu a conversa.",
  },
  action: {
    refund: "Reembolso feito.",
    refundAmount: "Reembolso feito: {amount}.",
    cancel: "Pedido cancelado.",
    return: "Devolução aberta.",
    exchange: "Troca criada.",
    discount: "Cupom ou desconto criado.",
    addressChange: "Endereço de entrega atualizado.",
    customerUpdate: "Dados do cliente atualizados.",
    other: "Ação na loja concluída: {action}.",
    reference: "Referência: {id}.",
    held: "O assistente de IA solicitou {noun}; o pedido foi enviado para aprovação de uma pessoa da equipe.",
    failed: "O assistente de IA tentou fazer {noun}, mas a ação não foi concluída.",
    failedWithReason:
      "O assistente de IA tentou fazer {noun}, mas a ação não foi concluída: {reason}",
    tracking: "Rastreamento do pedido consultado na loja:",
    trackingCarrier: "transportadora {carrier}",
    trackingNumber: "código de rastreio {number}",
    trackingStatus: "status {status}",
    trackingDelivered: "entregue em {at}",
  },
  noun: {
    refund: "um reembolso",
    cancel: "um cancelamento do pedido",
    return: "uma devolução",
    exchange: "uma troca",
    discount: "um cupom ou desconto",
    address_change: "uma alteração do endereço de entrega",
    customer_update: "uma alteração nos dados do cliente",
  },
  toolErrors: {
    codes: {
      NOT_FOUND: "a loja não encontrou o pedido, cliente ou item.",
      PRECONDITION: "a situação do pedido naquele momento não permitia.",
      PROVIDER_REFUSED: "a loja recusou o pedido.",
      OUTCOME_UNKNOWN: "a loja não confirmou se foi feito.",
      APPROVAL_REJECTED: "uma pessoa da equipe recusou o pedido.",
    },
    reasons: {
      EXCEEDS_REFUNDABLE: "o valor era maior do que ainda podia ser reembolsado neste pedido.",
      CUSTOMER_MISMATCH: "o pedido não pertence a este cliente.",
      ALREADY_CANCELLED: "o pedido já tinha sido cancelado.",
      ALREADY_SHIPPED: "o pedido já tinha sido enviado.",
      OUT_OF_STOCK: "o item estava sem estoque.",
      NOT_PAID: "o pedido não tinha sido pago.",
      IDENTITY_MISMATCH: "os dados do cliente não correspondiam ao pedido.",
      FULFILLMENT_IN_PROGRESS: "o pedido já estava sendo preparado para envio.",
      EMAIL_MISMATCH: "o e-mail informado não correspondia ao pedido.",
      ALREADY_REFUNDED: "isso já tinha sido reembolsado.",
      PENDING_REFUND: "já havia um reembolso em andamento para este pedido.",
      NOT_RETURNABLE: "o item não podia ser devolvido.",
      NOT_REFUNDABLE: "o pedido não podia ser reembolsado.",
      NOT_PRE_DISPATCH: "o pedido já tinha passado da etapa em que ainda podia ser alterado.",
      FULLY_REFUNDED: "o pedido já tinha sido totalmente reembolsado.",
      ALREADY_DISPATCHED: "o pedido já tinha sido despachado.",
    },
  },
  readme: [
    "Registro de comunicação com o cliente",
    "",
    "Gerado pelo Hay.chat em {at} para {store}.",
    "",
    "O que este ZIP contém:",
    "- evidence.pdf: o registro das conversas (mensagens que o cliente viu ou enviou, ações da loja e seus resultados, transferências para a equipe da loja, confirmações de entrega e leitura quando o canal as informou, e trechos das políticas da loja que o assistente de IA usou).",
    "- attachments/: os arquivos trocados nestas conversas que continuam armazenados.",
    "- manifest.json: o hash SHA-256 de cada arquivo deste ZIP, para que qualquer pessoa possa conferir que um arquivo não foi alterado depois de gerado.",
    "- README.txt: este arquivo.",
    "",
    "De onde vem: cada item foi registrado pelo Hay.chat no momento em que aconteceu. Notas internas, instruções do sistema e o raciocínio da IA ficam de fora. Só entram dados ainda armazenados pela configuração de retenção de dados da loja; o que foi apagado antes de {at} não pode fazer parte deste registro.",
    "",
    "Este é um registro do que aconteceu, não uma orientação jurídica. Ele não garante nenhum resultado, e nenhum provedor de pagamento ou banco o revisou ou aprovou.",
  ],
};

const TABLES: Record<EvidenceLocale, CopyTable> = { en, "pt-BR": ptBR };

export function evidenceCopy(locale: EvidenceLocale): CopyTable {
  return TABLES[locale] ?? en;
}

export { fill as fillCopy };
