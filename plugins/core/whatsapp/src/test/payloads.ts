/**
 * Realistic Meta WhatsApp Cloud API webhook payloads (Graph v26.0 shapes).
 * Builders keep tests short: `envelope(messagesValue({ messages: [textMessage()] }))`.
 */

export const PHONE_NUMBER_ID = "976350592236691";
export const OTHER_PHONE_NUMBER_ID = "111111111111111";
export const WABA_ID = "1234567890";
export const WA_ID = "5511999999999";
export const BSUID = "BR.1349120865530274";

type Json = Record<string, unknown>;

export function envelope(...changes: Json[]): Json {
  return { object: "whatsapp_business_account", entry: [{ id: WABA_ID, changes }] };
}

export function messagesChange(value: Json, phoneNumberId: string = PHONE_NUMBER_ID): Json {
  return {
    field: "messages",
    value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "15550783881", phone_number_id: phoneNumberId },
      ...value,
    },
  };
}

export const contact: Json = {
  profile: { name: "Ana" },
  wa_id: WA_ID,
  user_id: BSUID,
  identity_key_hash: "abc123",
};

let counter = 0;

/** An inbound message from Ana; `type` + its body object go in `extra`. */
export function inbound(extra: Json): Json {
  counter++;
  return {
    from: WA_ID,
    from_user_id: BSUID,
    id: `wamid.HBgNNTUxMTk5OTk5OTk5ORUCABIYFjNFQjA${counter}`,
    timestamp: "1760000000",
    ...extra,
  };
}

export function inboundChange(message: Json, contacts: Json[] = [contact]): Json {
  return messagesChange({ contacts, messages: [message] });
}

export const textMessage = (body = "Hi, is my order shipped?") =>
  inbound({ type: "text", text: { body } });

export const buttonReply = inbound({
  type: "interactive",
  context: { from: "15550783881", id: "wamid.OUTBOUND1" },
  interactive: {
    type: "button_reply",
    button_reply: { id: "track-order", title: "Track my order" },
  },
});

export const listReply = inbound({
  type: "interactive",
  context: { from: "15550783881", id: "wamid.OUTBOUND2" },
  interactive: {
    type: "list_reply",
    list_reply: { id: "size-m", title: "Medium", description: "Fits 38-40" },
  },
});

export const flowReply = inbound({
  type: "interactive",
  interactive: {
    type: "nfm_reply",
    nfm_reply: {
      name: "flow",
      body: "Sent",
      response_json: '{"flow_token":"t1","email":"ana@example.com"}',
    },
  },
});

export const templateButton = inbound({
  type: "button",
  context: { from: "15550783881", id: "wamid.TEMPLATE1" },
  button: { payload: "STOP_PROMOS", text: "Stop promotions" },
});

export const locationMessage = inbound({
  type: "location",
  location: {
    latitude: -23.5505,
    longitude: -46.6333,
    name: "Loja Centro",
    address: "Praça da Sé, São Paulo",
  },
});

export const contactsMessage = inbound({
  type: "contacts",
  contacts: [
    {
      name: { formatted_name: "Bruno Lima", first_name: "Bruno" },
      phones: [{ phone: "+55 11 98888-7777", wa_id: "5511988887777", type: "CELL" }],
    },
    { name: { formatted_name: "Carla" }, phones: [] },
  ],
});

export const orderMessage = inbound({
  type: "order",
  order: {
    catalog_id: "cat-1",
    text: "Gift wrap please",
    product_items: [
      { product_retailer_id: "SKU-1", quantity: 2, item_price: 10.5, currency: "BRL" },
      { product_retailer_id: "SKU-2", quantity: 1, item_price: 4, currency: "BRL" },
    ],
  },
});

export const requestWelcome = inbound({ type: "request_welcome" });

export const referralText = inbound({
  type: "text",
  text: { body: "I saw your ad" },
  context: { forwarded: true },
  referral: {
    source_url: "https://fb.me/ad",
    source_id: "ad-123",
    source_type: "ad",
    headline: "50% off",
    body: "Summer sale",
    media_type: "image",
    image_url: "https://example.com/ad.jpg",
    ctwa_clid: "clid-xyz",
  },
});

export const reaction = inbound({
  type: "reaction",
  reaction: { message_id: "wamid.OUTBOUND1", emoji: "👍" },
});

export const systemMessage = inbound({
  type: "system",
  system: { body: "User changed number", type: "user_changed_number", wa_id: "5511977776666" },
});

export const unsupported = inbound({
  type: "unsupported",
  errors: [{ code: 131051, title: "Message type unknown", message: "Message type unknown" }],
  unsupported: { type: "poll" },
});

export const imageMessage = inbound({
  type: "image",
  image: {
    id: "media-img-1",
    mime_type: "image/jpeg",
    sha256: "x",
    caption: "This arrived broken",
  },
});

export const voiceNote = inbound({
  type: "audio",
  audio: { id: "media-aud-1", mime_type: "audio/ogg; codecs=opus", sha256: "y", voice: true },
});

export const documentMessage = inbound({
  type: "document",
  document: {
    id: "media-doc-1",
    mime_type: "application/pdf",
    sha256: "z",
    filename: "invoice.pdf",
  },
});

export function statusEvent(status: string, extra: Json = {}): Json {
  return {
    id: `wamid.OUT-${status}`,
    status,
    timestamp: "1760000100",
    recipient_id: WA_ID,
    recipient_user_id: BSUID,
    pricing: { pricing_model: "PMP", type: "free_customer_service", category: "service" },
    ...extra,
  };
}

export const failedStatus = statusEvent("failed", {
  errors: [
    {
      code: 131047,
      title: "Re-engagement message",
      message: "Re-engagement message",
      error_data: { details: "Message failed to send because more than 24 hours have passed" },
      href: "https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/",
    },
  ],
});

export function accountUpdate(event: string): Json {
  return {
    field: "account_update",
    value: {
      phone_number: "15550783881",
      event,
      disconnection_info: { reason: "Partner app uninstalled", initiated_by: "USER" },
    },
  };
}
