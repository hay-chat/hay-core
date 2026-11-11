/**
 * Risk class of every tool this server registers (see @hay/plugin-sdk/tool-risk).
 * Tracking only reads, and its result carries no personal data.
 * tests/tool-risk.test.js keeps it complete.
 */
module.exports = {
  read: ["correios_track_shipment"],
  write: {},
};
