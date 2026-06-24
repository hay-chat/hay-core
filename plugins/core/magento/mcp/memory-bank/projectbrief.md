# Project Brief: Magento 2 MCP Server

## Overview
This project implements a Model Context Protocol (MCP) server that provides tools for interacting with a Magento 2 e-commerce platform. The server exposes various capabilities through tools that can be used to query and manipulate Magento 2 data.

## Core Requirements
1. Provide tools to query product information from Magento 2
2. Provide tools to query customer information from Magento 2
3. Provide tools to query order information from Magento 2
4. Provide tools to query revenue and sales metrics from Magento 2
5. Support filtering by date ranges, including relative dates like "today", "last week", "YTD"
6. Support filtering by geographic regions like countries

## Goals
- Enable natural language queries about Magento 2 store data
- Provide accurate and timely information about sales, orders, and revenue
- Support business intelligence and reporting needs
- Make e-commerce data easily accessible through conversational interfaces

## Success Criteria
- Successfully retrieve accurate order counts for specified date ranges
- Successfully retrieve accurate revenue figures for specified date ranges
- Successfully filter data by geographic regions
- Support common date range expressions like "today", "yesterday", "last week", "this month", "YTD"
- Provide clear and concise responses to queries

## Constraints
- Requires valid Magento 2 API credentials
- Depends on the Magento 2 API being available and responsive
- Limited to the data and capabilities exposed by the Magento 2 API
