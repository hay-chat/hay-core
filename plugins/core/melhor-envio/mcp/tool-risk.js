/**
 * Risk class of every tool this server registers (see @hay/plugin-sdk/tool-risk).
 * Both tools only read. tests/tool-risk.test.js keeps the list complete.
 */
module.exports = {
  read: ["melhorenvio_track_shipment", "melhorenvio_find_customer_shipments"],
  write: {},
  // Returns a customer's shipment history: core runs it only for a verified
  // customer, and it returns only that customer's shipments.
  customerData: ["melhorenvio_find_customer_shipments"],
};
