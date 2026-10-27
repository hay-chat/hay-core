/**
 * Risk class of every tool this server registers (see @hay/plugin-sdk/tool-risk).
 * Hay.chat core uses it to run reads freely, simulate writes in the playground
 * and hold money moves for approval. tests/tool-risk.test.js keeps it complete.
 */
module.exports = {
  read: [
    "woocommerce_get_store",
    "woocommerce_get_order",
    "woocommerce_get_order_tracking",
    "woocommerce_search_products",
    "woocommerce_get_product",
    "woocommerce_check_inventory",
    "woocommerce_find_customer",
    "woocommerce_list_customer_orders",
  ],
  write: {
    woocommerce_cancel_order: "cancel",
    woocommerce_create_refund: "refund",
    woocommerce_update_order_shipping_address: "address_change",
    woocommerce_add_order_note: "note",
  },
};
