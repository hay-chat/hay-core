# Hay Integrations & Actions

This document provides a comprehensive list of all available Hay integrations and their supported actions.

---

## Integrations Overview

| Integration | Category | Total Actions |
|-------------|----------|---------------|
| Zendesk | Support & Ticketing | 51 |
| Attio | CRM & Records | 30 |
| Stripe | Payments & Billing | 27 |
| WooCommerce | E-commerce | 25 |
| HubSpot | CRM & Sales | 15 |
| Magento | E-commerce & Analytics | 14 |
| Shopify | E-commerce | 9 |
| Judo in Cloud | Utility | 4 |
| Email | Communication | 2 |

**Total: 9 integrations with 177 available actions**

---

## Detailed Actions by Integration

### Zendesk

Connect your Zendesk account to manage tickets, customers, and support workflows.

| Action | Description |
|--------|-------------|
| `list_tickets` | List tickets with pagination and sorting |
| `get_ticket` | Get a specific ticket by ID |
| `create_ticket` | Create a new ticket with subject, comment, priority, status, assignee |
| `update_ticket` | Update an existing ticket |
| `delete_ticket` | Delete a ticket |
| `list_users` | List users with role filtering |
| `get_user` | Get a specific user by ID |
| `create_user` | Create a new user with name, email, role, phone |
| `update_user` | Update existing user information |
| `delete_user` | Delete a user |
| `list_organizations` | List organizations in Zendesk |
| `get_organization` | Get a specific organization by ID |
| `create_organization` | Create a new organization |
| `update_organization` | Update organization information |
| `delete_organization` | Delete an organization |
| `list_groups` | List agent groups |
| `get_group` | Get a specific group by ID |
| `create_group` | Create a new agent group |
| `update_group` | Update an existing group |
| `delete_group` | Delete a group |
| `list_macros` | List macros in Zendesk |
| `get_macro` | Get a specific macro by ID |
| `create_macro` | Create a new macro with title and actions |
| `update_macro` | Update an existing macro |
| `delete_macro` | Delete a macro |
| `list_views` | List views in Zendesk |
| `get_view` | Get a specific view by ID |
| `create_view` | Create a new view with conditions |
| `update_view` | Update an existing view |
| `delete_view` | Delete a view |
| `list_triggers` | List triggers in Zendesk |
| `get_trigger` | Get a specific trigger by ID |
| `create_trigger` | Create a new trigger with conditions and actions |
| `update_trigger` | Update an existing trigger |
| `delete_trigger` | Delete a trigger |
| `list_automations` | List automations in Zendesk |
| `get_automation` | Get a specific automation by ID |
| `create_automation` | Create a new automation with conditions and actions |
| `update_automation` | Update an existing automation |
| `delete_automation` | Delete an automation |
| `list_articles` | List Help Center articles |
| `get_article` | Get a specific Help Center article by ID |
| `create_article` | Create a new Help Center article with HTML body |
| `update_article` | Update an existing Help Center article |
| `delete_article` | Delete a Help Center article |
| `search` | Search across Zendesk data with sorting and pagination |
| `get_talk_stats` | Get Zendesk Talk statistics |
| `list_chats` | List Zendesk Chat conversations |

---

### HubSpot

Connect your HubSpot CRM to access and manage contacts, companies, deals, tickets, and other CRM objects.

| Action | Description |
|--------|-------------|
| `hubspot_create_contact` | Create a new contact with duplicate detection |
| `hubspot_update_contact` | Modify existing contact information |
| `hubspot_search_contacts` | Search for contacts using various criteria |
| `hubspot_create_company` | Create a new company with duplicate detection |
| `hubspot_update_company` | Modify existing company information |
| `hubspot_search_companies` | Search for companies using various criteria |
| `hubspot_get_company_activity` | Retrieve comprehensive engagement history for a company |
| `hubspot_get_recent_engagements` | Fetch recent activities across all CRM records |
| `hubspot_get_active_companies` | List recently modified companies |
| `hubspot_get_active_contacts` | List recently modified contacts |
| `hubspot_get_deals` | Retrieve deals from HubSpot CRM |
| `hubspot_get_tickets` | Retrieve support tickets from HubSpot CRM |
| `hubspot_get_products` | Retrieve products from HubSpot CRM |
| `hubspot_get_quotes` | Retrieve quotes from HubSpot CRM |
| `hubspot_get_invoices` | Retrieve invoices from HubSpot CRM |

---

### Shopify

Connect your Shopify store to manage products, orders, customers, and e-commerce operations.

| Action | Description |
|--------|-------------|
| `get-products` | Retrieve a list of products with optional title search filtering |
| `get-product-by-id` | Retrieve detailed information about a specific product |
| `create-product` | Create a new product in your Shopify store |
| `get-customers` | Retrieve a list of customers with optional search filtering |
| `update-customer` | Update customer information including personal details and metadata |
| `get-orders` | Retrieve orders with optional status filtering |
| `get-order-by-id` | Retrieve detailed information about a specific order |
| `update-order` | Update order information including tags, notes, and shipping address |
| `get-customer-orders` | Retrieve all orders for a specific customer |

---

### Stripe

Connect your Stripe account to manage payments, customers, subscriptions, and more.

| Action | Description |
|--------|-------------|
| `retrieve_balance` | Retrieve your current Stripe account balance |
| `create_coupon` | Create a new coupon for discounts |
| `list_coupons` | List all coupons |
| `create_customer` | Create a new customer |
| `list_customers` | List all customers with optional email filter |
| `list_disputes` | List all payment disputes with status filtering |
| `update_dispute` | Update a payment dispute with evidence and metadata |
| `create_invoice` | Create a new invoice |
| `create_invoice_item` | Create an invoice item to add to an invoice |
| `finalize_invoice` | Finalize an invoice to make it ready for payment |
| `list_invoices` | List all invoices with filtering options |
| `create_payment_link` | Create a payment link for accepting payments |
| `list_payment_intents` | List all payment intents with customer filtering |
| `create_price` | Create a new price for a product |
| `list_prices` | List all prices with filtering |
| `create_product` | Create a new product |
| `list_products` | List all products with active status filtering |
| `create_refund` | Create a refund for a charge or payment intent |
| `cancel_subscription` | Cancel a subscription |
| `list_subscriptions` | List all subscriptions with status filtering |
| `update_subscription` | Update a subscription |
| `search_stripe_resources` | Search across customers, invoices, payment intents, subscriptions, charges |
| `fetch_stripe_resources` | Fetch a specific Stripe resource by ID |

---

### Email

Send emails using the platform's email service with configurable recipient lists.

| Action | Description |
|--------|-------------|
| `healthcheck` | Check if the email plugin is working correctly |
| `send-email` | Send an email to configured recipients |

---

### WooCommerce

Connect your WooCommerce store to manage products, orders, customers, and e-commerce workflows.

| Action | Description |
|--------|-------------|
| `get_products` | Retrieve a list of products with search and status filtering |
| `get_product` | Get a specific product by ID |
| `create_product` | Create a new product |
| `update_product` | Update an existing product |
| `delete_product` | Delete a product |
| `get_orders` | Retrieve a list of orders with status and customer filtering |
| `get_order` | Get a specific order by ID |
| `create_order` | Create a new order with line items and addresses |
| `update_order` | Update an existing order |
| `get_customers` | Retrieve a list of customers with search and role filtering |
| `get_customer` | Get a specific customer by ID |
| `create_customer` | Create a new customer with billing/shipping addresses |
| `update_customer` | Update an existing customer |
| `get_product_categories` | Retrieve product categories |
| `create_product_category` | Create a new product category |
| `get_coupons` | Retrieve coupons |
| `create_coupon` | Create a new coupon with discount type and amount |

---

### Magento

Connect your Magento 2 e-commerce store to manage products, orders, customers, inventory, and analyze sales performance.

| Action | Description |
|--------|-------------|
| `get_product_by_sku` | Get detailed product information by SKU |
| `get_product_by_id` | Get detailed product information by numeric ID |
| `search_products` | Search for products using a query term with pagination |
| `advanced_product_search` | Search with advanced filtering and custom field criteria |
| `get_product_categories` | Get all categories for a specific product by SKU |
| `get_related_products` | Get products related to a specific product |
| `get_product_stock` | Get stock information for a product by SKU |
| `get_product_attributes` | Get all attributes (base and custom) for a product |
| `update_product_attribute` | Update a specific attribute of a product |
| `get_revenue` | Get total revenue for a date range with status filtering |
| `get_revenue_by_country` | Get revenue filtered by country for a date range |
| `get_order_count` | Get the number of orders for a date range |
| `get_product_sales` | Get statistics about quantity of products sold |
| `get_customer_ordered_products_by_email` | Get all ordered products for a customer by email |

---

### Attio

Connect to Attio CRM to manage companies, people, deals, tasks, lists, and records through natural language.

| Action | Description |
|--------|-------------|
| `aaa-health-check` | Run a lightweight health probe with deployment metadata |
| `smithery-debug-config` | Retrieve sanitized diagnostic information |
| `records_search` | Search across companies, people, deals, tasks, and records |
| `records_search_advanced` | Search with complex nested filters and multiple conditions |
| `records_search_by_relationship` | Search records using relationship anchors |
| `records_search_by_content` | Search record content (notes, activity, communications) |
| `records_search_by_timeframe` | Filter records by creation, update, or interaction timeframes |
| `records_search_batch` | Execute multiple searches in parallel |
| `search` | OpenAI compatibility search across CRM objects |
| `records_get_details` | Fetch a single record with enriched attribute formatting |
| `records_get_info` | Retrieve enriched info subsets for a record |
| `records_get_attributes` | Retrieve attribute metadata for a resource type |
| `records_discover_attributes` | Discover available attributes for a resource |
| `create-record` | Create new records (companies, people, deals, tasks) |
| `update-record` | Update existing record fields |
| `delete-record` | Delete a record from its object |
| `records_batch` | Execute batched record operations |
| `create-note` | Create note for companies, people, or deals |
| `list-notes` | Retrieve notes for a record with timestamps |
| `fetch` | Return canonical Attio record payload for search connector |

---

### Judo in Cloud

Judo in Cloud MCP plugin for user management and support.

| Action | Description |
|--------|-------------|
| `healthcheck` | Check if the plugin is working correctly |
| `reset_password` | Reset the password for a user |
| `contact` | Contact the Judo in Cloud team (support, sales, technical) |
| `check_email` | Check if an email is registered in the system |
