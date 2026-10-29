/**
 * Risk class of every tool this server registers (see @hay/plugin-sdk/tool-risk).
 * Hay.chat core uses it to run reads freely, simulate writes in the playground
 * and hold destructive actions for approval. tests/tool-risk.test.js keeps it complete.
 */
module.exports = {
  read: [
    "spacebring_get_member",
    "spacebring_find_available_spaces",
    "spacebring_search_guides",
    "spacebring_whats_on",
    "spacebring_list_perks",
    "spacebring_list_plans",
  ],
  // Bookings are calendar side effects, not money moves (Spacebring applies its
  // own credit rules), so they are not "cancel"/"refund".
  write: {
    spacebring_book_space: "other_write",
    // Books the new slot before freeing the old one: the member never ends up roomless.
    spacebring_move_booking: "other_write",
    // Frees the member's slot for good: always held for approval.
    spacebring_cancel_booking: "destructive",
    spacebring_invite_guest: "other_write",
    spacebring_cancel_guest_visit: "other_write",
    spacebring_report_issue: "note",
  },
};
