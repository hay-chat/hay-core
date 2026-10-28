/**
 * Risk class of every tool this server registers (see @hay/plugin-sdk/tool-risk).
 * Hay.chat core uses it to run reads freely, simulate writes in the playground
 * and hold money moves for approval. tests/tool-risk.test.js keeps it complete.
 */
module.exports = {
  read: [
    "shopify_get_shop",
    "shopify_get_order",
    "shopify_get_order_by_name",
    "shopify_get_order_tracking",
    "shopify_list_customer_orders",
    "shopify_calculate_refund",
    "shopify_get_returnable_items",
    "shopify_get_return_instructions",
    "shopify_get_product",
    "shopify_get_product_by_handle",
    "shopify_search_products",
    "shopify_find_customer",
    "shopify_get_customer",
    "shopify_check_inventory",
  ],
  write: {
    shopify_cancel_order: "cancel",
    shopify_create_refund: "refund",
    shopify_create_return: "return",
    shopify_update_order_shipping_address: "address_change",
    shopify_update_customer: "customer_update",
    shopify_update_customer_address: "customer_update",
    shopify_add_order_note: "note",
    shopify_create_coupon: "discount",
    shopify_swap_order_item: "exchange",
    shopify_create_exchange: "exchange",
    // Emails the invoice to the address on the order; moves no money.
    shopify_send_payment_link: "note",
  },
  // Enforces the merchant's coupon cap itself; above it, core holds the call.
  capped: ["shopify_create_coupon"],
};
