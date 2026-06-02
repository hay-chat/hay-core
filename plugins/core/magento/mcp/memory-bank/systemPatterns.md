# System Patterns: Magento 2 MCP Server

## System Architecture
The Magento 2 MCP Server follows a layered architecture pattern:

1. **Transport Layer**: Handles communication with clients using the Model Context Protocol (MCP). This is implemented using the StdioServerTransport from the MCP SDK.

2. **Tool Layer**: Defines the tools that clients can use to interact with the Magento 2 API. Each tool has a name, description, input schema, and implementation.

3. **Service Layer**: Contains the business logic for interacting with the Magento 2 API. This includes functions for making authenticated API requests, parsing responses, and formatting data.

4. **API Integration Layer**: Handles the specifics of the Magento 2 REST API, including authentication, endpoint construction, and error handling.

## Key Technical Decisions

### MCP Server Implementation
- Using the official MCP SDK to implement the server
- Exposing functionality through well-defined tools with clear input schemas
- Using stdio for transport to enable seamless integration with Claude

### Magento 2 API Integration
- Using REST API for all Magento 2 interactions
- Authentication via API tokens for security
- Handling pagination for large result sets
- Formatting responses for better readability

### Date Handling
- Supporting relative date expressions like "today", "yesterday", "last week"
- Converting these expressions to concrete date ranges for API queries
- Using ISO 8601 format for date representation internally

### Error Handling
- Comprehensive error handling at all layers
- Providing clear error messages to clients
- Graceful degradation when the Magento 2 API is unavailable

## Design Patterns in Use

### Factory Pattern
Used to create API request objects with the correct authentication and parameters.

### Adapter Pattern
The MCP server acts as an adapter between the MCP protocol and the Magento 2 API.

### Command Pattern
Each tool implements a specific command that can be executed by clients.

### Strategy Pattern
Different strategies for date parsing and filtering are implemented to handle various query types.

## Component Relationships

```
┌─────────────────────┐
│                     │
│  MCP Client (Claude)│
│                     │
└──────────┬──────────┘
           │
           │ MCP Protocol (stdio)
           │
┌──────────▼──────────┐
│                     │
│  Magento MCP Server │
│                     │
└──────────┬──────────┘
           │
           │ HTTP/REST
           │
┌──────────▼──────────┐
│                     │
│    Magento 2 API    │
│                     │
└──────────┬──────────┘
           │
           │
┌──────────▼──────────┐
│                     │
│  Magento 2 Database │
│                     │
└─────────────────────┘
```

## Data Flow

1. The client (Claude) sends a request to the MCP server using the MCP protocol.
2. The MCP server parses the request and identifies the appropriate tool to handle it.
3. The tool constructs a request to the Magento 2 API with the necessary parameters.
4. The Magento 2 API processes the request and returns a response.
5. The MCP server formats the response and sends it back to the client.
6. The client (Claude) presents the information to the user in a natural language format.
