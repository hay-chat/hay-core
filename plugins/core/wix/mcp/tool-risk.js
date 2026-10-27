/**
 * Risk class of every tool this server registers (see @hay/plugin-sdk/tool-risk).
 * Hay.chat core uses it to run reads freely, simulate writes in the playground
 * and hold money moves for approval. tests/tool-risk.test.js keeps it complete.
 */
module.exports = {
  read: [
    "wix_find_customer",
    "wix_list_customer_orders",
    "wix_search_products",
    "wix_get_product",
    "wix_get_order",
    "wix_get_order_tracking",
  ],
  write: {
    wix_cancel_order: "cancel",
    wix_create_refund: "refund",
    wix_update_order_shipping_address: "address_change",
  },
};
