/**
 * Risk class of every tool this server registers (see @hay/plugin-sdk/tool-risk).
 * Hay.chat core uses it to run reads freely, simulate writes in the playground
 * and hold money moves for approval. tests/tool-risk.test.js keeps it complete.
 */
module.exports = {
  read: [
    "magento_get_store",
    "magento_search_products",
    "magento_get_product",
    "magento_check_inventory",
    "magento_get_order",
    "magento_get_order_tracking",
    "magento_find_customer",
    "magento_list_customer_orders",
  ],
  write: {
    magento_cancel_order: "cancel",
    magento_create_refund: "refund",
    magento_update_order_shipping_address: "address_change",
    magento_add_order_note: "note",
    magento_resend_order_confirmation: "note",
  },
};
