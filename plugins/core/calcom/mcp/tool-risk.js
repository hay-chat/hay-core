/**
 * Risk class of every tool this server registers (see @hay/plugin-sdk/tool-risk).
 * Hay.chat core uses it to run reads freely, simulate writes in the playground
 * and hold money moves for approval. tests/tool-risk.test.js keeps it complete.
 */
module.exports = {
  read: ["get_me", "list_event_types", "get_available_slots", "list_bookings", "get_booking"],
  // Bookings are calendar side effects, not money moves: a booking cancel is
  // not a sale cancel.
  write: {
    create_booking: "other_write",
    cancel_booking: "other_write",
    reschedule_booking: "other_write",
  },
};
