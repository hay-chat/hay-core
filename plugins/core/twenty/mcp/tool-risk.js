/**
 * Risk class of every tool this server registers (see @hay/plugin-sdk/tool-risk).
 * Hay.chat core uses it to run reads freely, simulate writes in the playground
 * and hold money moves for approval. tests/tool-risk.test.js keeps it complete.
 */
module.exports = {
  read: [
    "find_person_by_email",
    "get_person",
    "search_people",
    "list_people_by_company",
    "find_company_by_domain",
    "find_company_by_name",
    "get_company",
    "search_companies",
    "list_companies",
    "list_notes_by_person",
    "list_notes_by_company",
    "find_tasks",
    "list_objects",
    "get_select_options",
    "list_records",
    "get_record",
  ],
  write: {
    create_person: "customer_update",
    update_person: "customer_update",
    create_company: "customer_update",
    update_company: "customer_update",
    create_note: "note",
    create_task: "note",
    update_task: "note",
    // Generic records can be any object (custom ones included).
    create_record: "other_write",
    update_record: "other_write",
    delete_record: "destructive",
  },
};
