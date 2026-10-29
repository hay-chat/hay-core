/**
 * Orders: one fixture → a short mutation sequence, so the store holds orders in the states the
 * Hay.chat Shopify plugin reads (displayFinancialStatus, displayFulfillmentStatus, fulfillments
 * with trackingInfo + latest event, refunds, note, tags, customer):
 *
 *   orderCreate (backdated processedAt, test order, no receipts, inventory bypassed)
 *   → fulfillmentCreate with tracking          (in_transit | stale | delivered)
 *   → fulfillmentEventCreate IN_TRANSIT        (at shippedDaysAgo)
 *   → fulfillmentEventCreate DELIVERED         (delivered, at deliveredDaysAgo)
 *   → refundCreate full or refundLines         (refunded | partially_refunded)
 *   → orderCancel                              (cancelled)
 *
 * Each order carries the tags `hay-demo` and `hay-demo:<fixture key>`; an order with that tag
 * is skipped on re-runs. `--reset-orders` archives and deletes the tagged orders first.
 */
import { DEMO_TAG, daysAgo, log, productBySku, trackingNumber } from "../lib/data";
import type { Customer, FinancialStatus, OrderFixture, OrderLine, Product } from "../lib/types";
import { assertNoUserErrors, type Shopify } from "./client";
import { mailingAddress } from "./customers";
import { money } from "./products";

const CURRENCY = "USD";
/** brand.md: free US shipping over $75, otherwise $6.90. */
const FREE_SHIPPING_OVER = 75;
const SHIPPING_PRICE = 6.9;
/** brand.md: 3–7 business days in transit; used for the carrier's estimated delivery. */
const TRANSIT_DAYS = 5;

export const orderTag = (key: string) => `${DEMO_TAG}:${key}`;

export interface OrderContext {
  products: Product[];
  /** Customer key → fixture customer. */
  customers: Record<string, Customer>;
  /** Customer key → Shopify customer id. */
  customerIds: Record<string, string>;
  /** SKU → Shopify variant id. */
  variantIds: Record<string, string>;
  now: Date;
}

export interface SeededOrder {
  key: string;
  /** created = this run, existing = found by tag and skipped, planned = dry-run. */
  status: "created" | "existing" | "planned";
  orderId: string | null;
  orderName: string | null;
  financialStatus: string;
  fulfillmentStatus: string;
  /** Latest shipment status (IN_TRANSIT, DELIVERED…), null when unshipped. */
  shipmentStatus: string | null;
  tracking: string | null;
  cancelled: boolean;
}

const round = (n: number) => Math.round(n * 100) / 100;
const iso = (days: number, now: Date) => daysAgo(days, now).toISOString();
const moneySet = (amount: number) => ({
  shopMoney: { amount: money(amount), currencyCode: CURRENCY },
});
const isShipped = (fixture: OrderFixture) => fixture.fulfillmentStatus !== "unfulfilled";

export function linePrice(products: Product[], sku: string): number {
  const { product, variant } = productBySku(products, sku);
  return variant.price?.USD ?? product.price.USD;
}

const linesTotal = (products: Product[], lines: OrderLine[]) =>
  round(lines.reduce((sum, line) => sum + linePrice(products, line.sku) * line.quantity, 0));

export function orderTotals(fixture: OrderFixture, products: Product[]) {
  const subtotal = linesTotal(products, fixture.lines);
  const shipping = subtotal > FREE_SHIPPING_OVER ? 0 : SHIPPING_PRICE;
  return { subtotal, shipping, total: round(subtotal + shipping) };
}

/** Refunds and partial refunds are created as paid orders first, then refunded. */
export function createFinancialStatus(status: FinancialStatus): string {
  if (status === "pending") return "PENDING";
  if (status === "voided") return "VOIDED";
  return "PAID";
}

/** The fixtures carry no refund date: a damage refund lands the day after delivery, a cancel
 * refund 5 days after the order was placed (the "refunded" fixture: 3 days ago). */
export function refundDaysAgo(fixture: OrderFixture): number {
  if (fixture.deliveredDaysAgo !== undefined) return Math.max(fixture.deliveredDaysAgo - 1, 0);
  return Math.max(fixture.placedDaysAgo - 5, 0);
}

export function carrierOf(fixture: OrderFixture): string {
  return fixture.carrier?.shopify ?? "USPS";
}

export function trackingUrl(carrier: string, number: string): string | null {
  if (carrier === "USPS") return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${number}`;
  if (carrier === "UPS") return `https://www.ups.com/track?tracknum=${number}`;
  return null;
}

const gateway = (fixture: OrderFixture) => fixture.paymentMethod?.shopify ?? "manual";

/** OrderCreateOrderInput for a fixture. */
export function orderCreateInput(
  fixture: OrderFixture,
  ctx: OrderContext,
): Record<string, unknown> {
  const customerKey = fixture.customer.shopify;
  const customer = customerKey ? ctx.customers[customerKey] : undefined;
  if (!customerKey || !customer) throw new Error(`Order ${fixture.key} has no Shopify customer`);
  const customerId = ctx.customerIds[customerKey];
  if (!customerId) throw new Error(`Customer ${customerKey} was not seeded`);
  const { shipping, total } = orderTotals(fixture, ctx.products);
  const financialStatus = createFinancialStatus(fixture.financialStatus);
  const processedAt = iso(fixture.placedDaysAgo, ctx.now);
  const address = mailingAddress(customer.address);

  return {
    currency: CURRENCY,
    test: true,
    processedAt,
    financialStatus,
    email: customer.email,
    customer: { toAssociate: { id: customerId } },
    shippingAddress: address,
    billingAddress: address,
    note: fixture.note ?? null,
    tags: [DEMO_TAG, orderTag(fixture.key)],
    lineItems: fixture.lines.map((line) => {
      const variantId = ctx.variantIds[line.sku];
      if (!variantId) throw new Error(`SKU ${line.sku} has no Shopify variant`);
      return {
        variantId,
        quantity: line.quantity,
        priceSet: moneySet(linePrice(ctx.products, line.sku)),
      };
    }),
    shippingLines: [{ title: "Standard shipping", code: "standard", priceSet: moneySet(shipping) }],
    // Only a captured payment gets a transaction; it's the parent refunds point at.
    transactions:
      financialStatus === "PAID"
        ? [
            {
              kind: "SALE",
              status: "SUCCESS",
              gateway: gateway(fixture),
              test: true,
              processedAt,
              amountSet: moneySet(total),
            },
          ]
        : [],
  };
}

const ORDER_STATE_FIELDS = `
  id
  name
  tags
  closed
  cancelledAt
  displayFinancialStatus
  displayFulfillmentStatus
  fulfillments(first: 5) { displayStatus trackingInfo { company number } }
`;

interface OrderState {
  id: string;
  name: string;
  tags: string[];
  closed: boolean;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  fulfillments: {
    displayStatus: string | null;
    trackingInfo: { company: string | null; number: string | null }[];
  }[];
}

function toSeeded(key: string, status: SeededOrder["status"], order: OrderState): SeededOrder {
  const shipment = order.fulfillments[0];
  const info = shipment?.trackingInfo[0];
  return {
    key,
    status,
    orderId: order.id,
    orderName: order.name,
    financialStatus: order.displayFinancialStatus ?? "",
    fulfillmentStatus: order.displayFulfillmentStatus,
    shipmentStatus: shipment?.displayStatus ?? null,
    tracking: info?.number ? `${info.company ?? ""} ${info.number}`.trim() : null,
    cancelled: order.cancelledAt !== null,
  };
}

/** What the order should look like once seeded; used for the dry-run summary. */
export function expectedState(fixture: OrderFixture): SeededOrder {
  const shipped = isShipped(fixture);
  return {
    key: fixture.key,
    status: "planned",
    orderId: null,
    orderName: null,
    financialStatus: fixture.financialStatus.toUpperCase(),
    fulfillmentStatus: shipped ? "FULFILLED" : "UNFULFILLED",
    shipmentStatus: shipped
      ? fixture.fulfillmentStatus === "delivered"
        ? "DELIVERED"
        : "IN_TRANSIT"
      : null,
    tracking: shipped ? `${carrierOf(fixture)} ${trackingNumber(fixture, "shopify")}` : null,
    cancelled: fixture.cancelled === true,
  };
}

/** Demo orders by tag. `tag` defaults to every demo order. */
export async function findDemoOrders(shop: Shopify, tag = DEMO_TAG): Promise<OrderState[]> {
  if (shop.dryRun) return [];
  const found: OrderState[] = [];
  let cursor: string | null = null;
  do {
    type Page = {
      orders: { nodes: OrderState[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    };
    const data: Page = await shop.query<Page>(
      `query FindOrders($query: String!, $cursor: String) {
        orders(first: 50, after: $cursor, query: $query) {
          nodes { ${ORDER_STATE_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { query: `tag:"${tag}"`, cursor },
    );
    // Tag search is not exact (it tokenises), so filter on the real tag list.
    found.push(...data.orders.nodes.filter((o) => o.tags.includes(tag)));
    cursor = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
  } while (cursor);
  return found;
}

const ORDER_CREATE = `
  mutation OrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      order { id name }
      userErrors { field message }
    }
  }
`;

const FULFILLMENT_ORDERS = `
  query FulfillmentOrders($id: ID!) {
    order(id: $id) { fulfillmentOrders(first: 5) { nodes { id status } } }
  }
`;

const FULFILLMENT_CREATE = `
  mutation FulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment { id status }
      userErrors { field message }
    }
  }
`;

const FULFILLMENT_EVENT_CREATE = `
  mutation FulfillmentEventCreate($fulfillmentEvent: FulfillmentEventInput!) {
    fulfillmentEventCreate(fulfillmentEvent: $fulfillmentEvent) {
      fulfillmentEvent { id status happenedAt }
      userErrors { field message }
    }
  }
`;

const REFUND_DETAILS = `
  query RefundDetails($id: ID!) {
    order(id: $id) {
      lineItems(first: 50) { nodes { id sku quantity } }
      transactions(first: 10) { id kind status gateway }
    }
  }
`;

// 2026-04 makes @idempotent(key:) mandatory on refundCreate (same as the plugin's refund tool).
const REFUND_CREATE = `
  mutation RefundCreate($input: RefundInput!, $key: String!) {
    refundCreate(input: $input) @idempotent(key: $key) {
      refund { id }
      userErrors { field message }
    }
  }
`;

const ORDER_CANCEL = `
  mutation OrderCancel($orderId: ID!, $reason: OrderCancelReason!, $restock: Boolean!, $refundMethod: OrderCancelRefundMethodInput, $notifyCustomer: Boolean, $staffNote: String) {
    orderCancel(orderId: $orderId, reason: $reason, restock: $restock, refundMethod: $refundMethod, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
      job { id done }
      orderCancelUserErrors { field message code }
      userErrors { field message }
    }
  }
`;

const ORDER_STATE = `query OrderState($id: ID!) { order(id: $id) { ${ORDER_STATE_FIELDS} } }`;

async function fulfil(
  shop: Shopify,
  fixture: OrderFixture,
  orderId: string,
  now: Date,
): Promise<void> {
  let fulfillmentOrderIds = [`gid://shopify/FulfillmentOrder/dry-run-${fixture.key}`];
  if (!shop.dryRun) {
    const data = await shop.query<{
      order: { fulfillmentOrders: { nodes: { id: string; status: string }[] } };
    }>(FULFILLMENT_ORDERS, { id: orderId });
    fulfillmentOrderIds = data.order.fulfillmentOrders.nodes
      .filter((f) => f.status === "OPEN")
      .map((f) => f.id);
    if (fulfillmentOrderIds.length === 0)
      throw new Error(`${fixture.key}: no open fulfillment order to fulfil`);
  }

  const carrier = carrierOf(fixture);
  const number = trackingNumber(fixture, "shopify");
  const created = await shop.mutate<{
    fulfillmentCreate: { fulfillment: { id: string }; userErrors: [] };
  }>(
    FULFILLMENT_CREATE,
    {
      fulfillment: {
        lineItemsByFulfillmentOrder: fulfillmentOrderIds.map((fulfillmentOrderId) => ({
          fulfillmentOrderId,
        })),
        notifyCustomer: false,
        trackingInfo: { company: carrier, number, url: trackingUrl(carrier, number) },
      },
    },
    {
      fulfillmentCreate: {
        fulfillment: { id: `gid://shopify/Fulfillment/dry-run-${fixture.key}` },
        userErrors: [],
      },
    },
  );
  assertNoUserErrors(`fulfillmentCreate ${fixture.key}`, created.fulfillmentCreate);
  const fulfillmentId = created.fulfillmentCreate.fulfillment.id;

  const shippedDaysAgo = fixture.shippedDaysAgo ?? fixture.placedDaysAgo;
  const events: Record<string, unknown>[] = [
    {
      status: "IN_TRANSIT",
      happenedAt: iso(shippedDaysAgo, now),
      estimatedDeliveryAt: iso(shippedDaysAgo - TRANSIT_DAYS, now),
      message: `Picked up by ${carrier}, in transit`,
    },
  ];
  if (fixture.fulfillmentStatus === "delivered") {
    events.push({
      status: "DELIVERED",
      happenedAt: iso(fixture.deliveredDaysAgo ?? 0, now),
      message: "Delivered, left at front door",
    });
  }
  // "stale" stops at IN_TRANSIT: no carrier update since shippedDaysAgo.
  for (const event of events) {
    const data = await shop.mutate<{ fulfillmentEventCreate: { userErrors: [] } }>(
      FULFILLMENT_EVENT_CREATE,
      { fulfillmentEvent: { fulfillmentId, ...event } },
      { fulfillmentEventCreate: { userErrors: [] } },
    );
    assertNoUserErrors(
      `fulfillmentEventCreate ${fixture.key} ${String(event.status)}`,
      data.fulfillmentEventCreate,
    );
  }
}

type RefundDetails = {
  order: {
    lineItems: { nodes: { id: string; sku: string | null; quantity: number }[] };
    transactions: { id: string; kind: string; status: string; gateway: string }[];
  };
};

/** RefundInput for a fixture: every line + shipping (refunded) or only refundLines (partial). */
export function refundInput(
  fixture: OrderFixture,
  orderId: string,
  details: RefundDetails["order"],
  products: Product[],
  now: Date,
): Record<string, unknown> {
  const full = fixture.financialStatus === "refunded";
  const lines = full ? fixture.lines : (fixture.refundLines ?? []);
  if (lines.length === 0) throw new Error(`${fixture.key}: partially_refunded needs refundLines`);
  const sale = details.transactions.find((t) => t.kind === "SALE" && t.status === "SUCCESS");
  if (!sale) throw new Error(`${fixture.key}: no successful sale transaction to refund`);
  const amount = full ? orderTotals(fixture, products).total : linesTotal(products, lines);

  return {
    orderId,
    notify: false,
    processedAt: iso(refundDaysAgo(fixture), now),
    note: full
      ? (fixture.note ?? "Refunded in full.")
      : `Partial refund: ${lines.map((l) => `${l.quantity} × ${productBySku(products, l.sku).product.title.en}`).join(", ")} (damaged in transit).`,
    refundLineItems: lines.map((line) => {
      const item = details.lineItems.nodes.find((n) => n.sku === line.sku);
      if (!item) throw new Error(`${fixture.key}: order has no line for ${line.sku}`);
      return { lineItemId: item.id, quantity: line.quantity, restockType: "NO_RESTOCK" };
    }),
    ...(full ? { shipping: { fullRefund: true } } : {}),
    transactions: [
      { orderId, parentId: sale.id, amount: money(amount), gateway: sale.gateway, kind: "REFUND" },
    ],
  };
}

async function refund(
  shop: Shopify,
  fixture: OrderFixture,
  orderId: string,
  ctx: OrderContext,
): Promise<void> {
  let details: RefundDetails["order"] = {
    lineItems: {
      nodes: fixture.lines.map((l) => ({
        id: `gid://shopify/LineItem/dry-run-${l.sku}`,
        sku: l.sku,
        quantity: l.quantity,
      })),
    },
    transactions: [
      {
        id: "gid://shopify/OrderTransaction/dry-run",
        kind: "SALE",
        status: "SUCCESS",
        gateway: gateway(fixture),
      },
    ],
  };
  if (!shop.dryRun)
    details = (await shop.query<RefundDetails>(REFUND_DETAILS, { id: orderId })).order;
  const input = refundInput(fixture, orderId, details, ctx.products, ctx.now);
  const data = await shop.mutate<{
    refundCreate: { refund: { id: string } | null; userErrors: [] };
  }>(
    REFUND_CREATE,
    // Stable per order, so a retried run can't refund twice.
    { input, key: `hay-demo-refund-${orderId.split("/").pop()}` },
    { refundCreate: { refund: { id: "gid://shopify/Refund/dry-run" }, userErrors: [] } },
  );
  assertNoUserErrors(`refundCreate ${fixture.key}`, data.refundCreate);
}

async function cancel(shop: Shopify, fixture: OrderFixture, orderId: string): Promise<void> {
  const unpaid = fixture.financialStatus === "voided" || fixture.financialStatus === "pending";
  type Payload = { orderCancel: { orderCancelUserErrors: []; userErrors: [] } };
  const data = await shop.mutate<Payload>(
    ORDER_CANCEL,
    {
      orderId,
      reason: unpaid ? "OTHER" : "CUSTOMER",
      // Inventory was bypassed at orderCreate, so restocking would inflate stock.
      restock: false,
      // Any refund was already recorded by refundCreate (with its own date).
      refundMethod: { originalPaymentMethodsRefund: false },
      notifyCustomer: false,
      staffNote:
        fixture.note ?? (unpaid ? "Cancelled automatically: payment never arrived." : null),
    },
    { orderCancel: { orderCancelUserErrors: [], userErrors: [] } },
  );
  assertNoUserErrors(`orderCancel ${fixture.key}`, {
    userErrors: data.orderCancel.orderCancelUserErrors,
  });
  assertNoUserErrors(`orderCancel ${fixture.key}`, data.orderCancel);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Final state as Shopify reports it. orderCancel runs as a job, so wait briefly for it. */
async function readState(
  shop: Shopify,
  fixture: OrderFixture,
  orderId: string,
  pollMs: number,
): Promise<OrderState> {
  for (let attempt = 0; ; attempt++) {
    const { order } = await shop.query<{ order: OrderState }>(ORDER_STATE, { id: orderId });
    if (!fixture.cancelled || order.cancelledAt || attempt >= 5) return order;
    await sleep(pollMs);
  }
}

/** Creates one fixture's order unless an order already carries its tag. */
export async function seedOrder(
  shop: Shopify,
  fixture: OrderFixture,
  ctx: OrderContext,
  options: { pollMs?: number } = {},
): Promise<SeededOrder> {
  const [existing] = await findDemoOrders(shop, orderTag(fixture.key));
  if (existing) {
    log(`Order ${fixture.key}: exists as ${existing.name}, skipped`);
    return toSeeded(fixture.key, "existing", existing);
  }

  log(
    `Order ${fixture.key}: creating (${fixture.financialStatus}, ${fixture.fulfillmentStatus}${fixture.cancelled ? ", cancelled" : ""})`,
  );
  const created = await shop.mutate<{
    orderCreate: { order: { id: string; name: string } | null; userErrors: [] };
  }>(
    ORDER_CREATE,
    {
      order: orderCreateInput(fixture, ctx),
      // No order confirmation or shipping emails; stock levels stay as the product step set them.
      options: { sendReceipt: false, sendFulfillmentReceipt: false, inventoryBehaviour: "BYPASS" },
    },
    {
      orderCreate: {
        order: { id: `gid://shopify/Order/dry-run-${fixture.key}`, name: "(dry-run)" },
        userErrors: [],
      },
    },
  );
  assertNoUserErrors(`orderCreate ${fixture.key}`, created.orderCreate);
  const orderId = created.orderCreate.order?.id;
  if (!orderId) throw new Error(`orderCreate ${fixture.key}: no order returned`);

  if (isShipped(fixture)) await fulfil(shop, fixture, orderId, ctx.now);
  if (fixture.financialStatus === "refunded" || fixture.financialStatus === "partially_refunded") {
    await refund(shop, fixture, orderId, ctx);
  }
  if (fixture.cancelled) await cancel(shop, fixture, orderId);

  if (shop.dryRun) return expectedState(fixture);
  return toSeeded(
    fixture.key,
    "created",
    await readState(shop, fixture, orderId, options.pollMs ?? 1000),
  );
}

/** Archives (when needed) and deletes demo-tagged orders, all of them or only `keys`. */
export async function resetOrders(shop: Shopify, keys: Set<string>): Promise<void> {
  if (shop.dryRun) {
    log("  [dry-run] --reset-orders: lookups are skipped, so no demo order is found to delete");
    return;
  }
  const orders = (await findDemoOrders(shop)).filter(
    (o) => keys.size === 0 || [...keys].some((key) => o.tags.includes(orderTag(key))),
  );
  for (const order of orders) {
    // Shopify only deletes archived (closed) or cancelled orders.
    if (!order.closed && !order.cancelledAt) {
      const closed = await shop.mutate<{ orderClose: { userErrors: [] } }>(
        `mutation OrderClose($input: OrderCloseInput!) { orderClose(input: $input) { order { id closed } userErrors { field message } } }`,
        { input: { id: order.id } },
        { orderClose: { userErrors: [] } },
      );
      assertNoUserErrors(`orderClose ${order.name}`, closed.orderClose);
    }
    const deleted = await shop.mutate<{ orderDelete: { userErrors: [] } }>(
      `mutation OrderDelete($orderId: ID!) { orderDelete(orderId: $orderId) { deletedId userErrors { field message code } } }`,
      { orderId: order.id },
      { orderDelete: { userErrors: [] } },
    );
    assertNoUserErrors(`orderDelete ${order.name}`, deleted.orderDelete);
    log(
      `Deleted order ${order.name} (${order.tags.filter((t) => t.startsWith(`${DEMO_TAG}:`)).join(", ")})`,
    );
  }
}
