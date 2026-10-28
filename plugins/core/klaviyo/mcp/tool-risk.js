/**
 * Risk class of every tool this server registers (see @hay/plugin-sdk/tool-risk).
 * Hay.chat core uses it to run reads freely, simulate writes in the playground
 * and hold money moves for approval. tests/tool-risk.test.js keeps it complete.
 */
module.exports = {
  read: [
    "get_account_details",
    "get_campaigns",
    "get_campaign",
    "get_campaign_report",
    "get_catalog_items",
    "get_events",
    "get_flows",
    "get_flow",
    "get_flow_report",
    "get_lists",
    "get_list",
    "get_metrics",
    "get_metric",
    "get_profiles",
    "get_profile",
    "get_segments",
    "get_segment",
    "get_email_template",
  ],
  write: {
    create_profile: "customer_update",
    update_profile: "customer_update",
    subscribe_profile_to_marketing: "customer_update",
    unsubscribe_profile_from_marketing: "customer_update",
    create_event: "other_write",
    create_campaign: "other_write",
    assign_template_to_campaign_message: "other_write",
    create_email_template: "other_write",
    upload_image_from_url: "other_write",
  },
};
