#!/usr/bin/env node
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function main() {
  try {
    console.log('Connecting to Magento MCP Server...');
    
    // Create a transport that will start the server process
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['./mcp-server.js']
    });
    
    // Create a client
    const client = new Client(
      {
        name: 'test-client',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );
    
    // Connect to the server
    await client.connect(transport);
    console.log('Connected to Magento MCP Server');
    
    // List available tools
    const tools = await client.listTools();
    console.log('Available tools:');
    tools.tools.forEach(tool => {
      console.log(`- ${tool.name}: ${tool.description}`);
    });
    
    // Test a tool: search for products
    console.log('\nSearching for products with "shirt"...');
    const searchResult = await client.callTool({
      name: 'search_products',
      arguments: {
        query: 'shirt',
        page_size: 5
      }
    });
    
    console.log('Search results:');
    console.log(searchResult.content[0].text);
    
    // Test the order count tool
    console.log('\nGetting order count for today...');
    try {
      const orderCountResult = await client.callTool({
        name: 'get_order_count',
        arguments: {
          date_range: 'today'
        }
      });
      
      console.log('Order count:');
      console.log(orderCountResult.content[0].text);
    } catch (error) {
      console.log('Error getting order count:', error.message);
    }
    
    // Test the revenue tool
    console.log('\nGetting revenue for last week...');
    try {
      const revenueResult = await client.callTool({
        name: 'get_revenue',
        arguments: {
          date_range: 'last week',
          include_tax: true
        }
      });
      
      console.log('Revenue:');
      console.log(revenueResult.content[0].text);
    } catch (error) {
      console.log('Error getting revenue:', error.message);
    }
    
    // Test the revenue by country tool
    console.log('\nGetting revenue for The Netherlands this YTD...');
    try {
      const revenueByCountryResult = await client.callTool({
        name: 'get_revenue_by_country',
        arguments: {
          date_range: 'ytd',
          country: 'The Netherlands',
          include_tax: true
        }
      });
      
      console.log('Revenue by country:');
      console.log(revenueByCountryResult.content[0].text);
    } catch (error) {
      console.log('Error getting revenue by country:', error.message);
    }
    
    // Test the product sales tool
    console.log('\nGetting product sales statistics for last month...');
    try {
      const productSalesResult = await client.callTool({
        name: 'get_product_sales',
        arguments: {
          date_range: 'last month'
        }
      });
      
      console.log('Product sales statistics:');
      console.log(productSalesResult.content[0].text);
    } catch (error) {
      console.log('Error getting product sales statistics:', error.message);
    }
    
    // Test the customer ordered products by email tool
    console.log('\nGetting ordered products for customer by email...');
    try {
      const customerOrdersResult = await client.callTool({
        name: 'get_customer_ordered_products_by_email',
        arguments: {
          email: 'customer@example.com' // Replace with a valid customer email
        }
      });
      
      console.log('Customer ordered products:');
      console.log(customerOrdersResult.content[0].text);
    } catch (error) {
      console.log('Error getting customer ordered products:', error.message);
    }
    
    // Close the connection
    await client.close();
    console.log('Connection closed');
  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);
