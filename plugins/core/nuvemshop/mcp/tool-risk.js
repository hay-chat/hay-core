/**
 * Risk class of every tool this server registers (see @hay/plugin-sdk/tool-risk).
 * Hay.chat core uses it to run reads freely, simulate writes in the playground
 * and hold money moves for approval. tests/tool-risk.test.js keeps it complete.
 *
 * nuvemshop_request_refund only writes the request on the order (the Nuvemshop
 * API cannot move money), so it is a note, not a refund.
 */
module.exports = {
  read: [
    "nuvemshop_get_store",
    "nuvemshop_get_order",
    "nuvemshop_get_order_tracking",
    "nuvemshop_get_payment_link",
    "nuvemshop_find_customer",
    "nuvemshop_get_customer",
    "nuvemshop_list_customer_orders",
    "nuvemshop_check_refund_status",
    "nuvemshop_search_products",
    "nuvemshop_get_product",
    "nuvemshop_check_inventory",
    "nuvemshop_list_categories",
  ],
  write: {
    nuvemshop_cancel_order: "cancel",
    nuvemshop_update_order_shipping_address: "address_change",
    nuvemshop_add_order_note: "note",
    nuvemshop_request_refund: "note",
    nuvemshop_create_coupon: "discount",
  },
};
