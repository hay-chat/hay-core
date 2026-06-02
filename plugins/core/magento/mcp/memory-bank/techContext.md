# Technical Context: Magento 2 MCP Server

## Technologies Used

### Core Technologies
- **Node.js**: The runtime environment for the MCP server
- **JavaScript**: The programming language used for implementation
- **Model Context Protocol (MCP)**: The protocol for communication between Claude and the server
- **Magento 2 REST API**: The API used to interact with the Magento 2 e-commerce platform

### Key Libraries and Dependencies
- **@modelcontextprotocol/sdk**: The official MCP SDK for implementing MCP servers and clients
- **axios**: HTTP client for making requests to the Magento 2 API
- **zod**: Schema validation library for defining tool input schemas
- **dotenv**: For loading environment variables from a .env file
- **date-fns**: For date manipulation and parsing

## Development Setup

### Environment Variables
The server requires the following environment variables:
- `MAGENTO_BASE_URL`: The base URL of the Magento 2 REST API
- `MAGENTO_API_TOKEN`: The API token for authenticating with the Magento 2 API

These can be set in a `.env` file in the project root or provided directly when running the server.

### Running the Server
The server can be run directly with Node.js:
```bash
node mcp-server.js
```

Or it can be run through the test client:
```bash
node test-mcp-server.js
```

### Testing
The `test-mcp-server.js` file provides a simple client for testing the MCP server. It connects to the server, lists available tools, and tests some of the tools with sample parameters.

## Technical Constraints

### Magento 2 API Limitations
- The Magento 2 API may have rate limits that could affect performance
- Some operations may be slow for large datasets
- Not all Magento 2 data is exposed through the API
- API structure and capabilities may vary between Magento 2 versions

### MCP Protocol Constraints
- Communication is synchronous and request-response based
- Tools must have well-defined input schemas
- Complex data structures must be serialized to JSON

### Performance Considerations
- Large result sets should be paginated
- Expensive operations should be optimized or cached
- Error handling should be robust to prevent crashes

## Dependencies

### External Systems
- **Magento 2 E-commerce Platform**: The primary data source for the MCP server
- **Claude AI Assistant**: The primary client for the MCP server

### Internal Dependencies
- **callMagentoApi**: Helper function for making authenticated requests to the Magento 2 API
- **Date parsing utilities**: For converting relative date expressions to concrete date ranges
- **Formatting functions**: For formatting API responses for better readability

## Integration Points

### Magento 2 API Endpoints
- `/orders`: For retrieving order information
- `/invoices`: For retrieving invoice and revenue information
- `/customers`: For retrieving customer information
- `/products`: For retrieving product information
- `/store/storeConfigs`: For retrieving store configuration information

### MCP Tools
The server exposes various tools for interacting with the Magento 2 API, including:
- Tools for retrieving product information
- Tools for searching products
- Tools for retrieving customer information
- Tools for retrieving order information
- Tools for retrieving revenue information
