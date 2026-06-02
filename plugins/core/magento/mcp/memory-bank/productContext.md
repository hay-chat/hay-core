# Product Context: Magento 2 MCP Server

## Why This Project Exists
The Magento 2 MCP Server exists to bridge the gap between natural language interfaces (like Claude) and the structured data in a Magento 2 e-commerce platform. It enables users to query business-critical information using conversational language rather than having to learn complex query languages or navigate through multiple admin screens.

## Problems It Solves
1. **Accessibility of Data**: E-commerce data is often locked behind complex admin interfaces or requires technical knowledge to query. This server makes that data accessible through natural language.

2. **Time Efficiency**: Instead of navigating through multiple screens or running reports, users can simply ask questions like "how many orders do we have today" or "what is our revenue in The Netherlands this YTD".

3. **Decision Support**: By making it easier to access sales and revenue data, the server supports better and faster business decision-making.

4. **Integration with AI Assistants**: The MCP server enables AI assistants like Claude to directly interact with Magento 2 data, expanding their capabilities in the e-commerce domain.

## How It Should Work
1. The user asks a question about Magento 2 data in natural language.
2. The AI assistant (Claude) interprets the question and calls the appropriate MCP tool with the right parameters.
3. The MCP server translates these parameters into Magento 2 API calls.
4. The server processes the response from Magento 2 and formats it in a way that's easy for the AI assistant to understand.
5. The AI assistant presents the information to the user in a natural, conversational way.

## User Experience Goals
1. **Simplicity**: Users should be able to get the information they need without understanding the underlying technical details.

2. **Accuracy**: The data provided should be accurate and consistent with what's available in the Magento 2 admin interface.

3. **Contextual Understanding**: The system should understand relative date ranges like "today", "last week", or "YTD" without requiring explicit date formatting.

4. **Geographical Filtering**: Users should be able to filter data by geographical regions like countries or regions.

5. **Comprehensive Coverage**: The system should cover all key e-commerce metrics, including orders, revenue, products, and customers.

6. **Responsiveness**: Queries should be processed quickly, providing near real-time access to e-commerce data.
