/**
 * Pagination System Test Examples
 * This file demonstrates how to use the new global pagination system
 */

import axios from "axios";

const API_URL = "http://localhost:3000/trpc";

// Helper function to make tRPC requests
async function trpcCall(procedure: string, input?: unknown, headers?: Record<string, string>) {
  const response = await axios.post(`${API_URL}/${procedure}`, input, {
    headers,
  });
  return response.data;
}

// Example 1: Basic pagination
async function testBasicPagination() {
  console.log("Testing basic pagination...");

  const result = await trpcCall("v1.documents.list", {
    pagination: { page: 1, limit: 10 },
  });

  console.log("Basic pagination result:", {
    itemCount: result.items.length,
    pagination: result.pagination,
  });
}

// Example 2: Pagination with sorting
async function testPaginationWithSorting() {
  console.log("Testing pagination with sorting...");

  const result = await trpcCall("v1.documents.list", {
    pagination: { page: 1, limit: 5 },
    sorting: { orderBy: "title", orderDirection: "asc" },
  });

  console.log("Pagination with sorting result:", {
    itemCount: result.items.length,
    firstItemTitle: result.items[0]?.title,
    pagination: result.pagination,
  });
}

// Example 3: Pagination with search
async function testPaginationWithSearch() {
  console.log("Testing pagination with search...");

  const result = await trpcCall("v1.documents.list", {
    pagination: { page: 1, limit: 10 },
    search: {
      query: "customer support",
      searchFields: ["title", "content"],
    },
  });

  console.log("Pagination with search result:", {
    itemCount: result.items.length,
    pagination: result.pagination,
  });
}

// Example 4: Pagination with filters
async function testPaginationWithFilters() {
  console.log("Testing pagination with filters...");

  const result = await trpcCall("v1.documents.list", {
    pagination: { page: 1, limit: 10 },
    filters: {
      type: "ARTICLE",
      status: "PUBLISHED",
    },
  });

  console.log("Pagination with filters result:", {
    itemCount: result.items.length,
    pagination: result.pagination,
  });
}

// Example 5: Pagination with date range
async function testPaginationWithDateRange() {
  console.log("Testing pagination with date range...");

  const result = await trpcCall("v1.documents.list", {
    pagination: { page: 1, limit: 10 },
    dateRange: {
      from: "2024-01-01T00:00:00Z",
      to: "2024-12-31T23:59:59Z",
    },
  });

  console.log("Pagination with date range result:", {
    itemCount: result.items.length,
    pagination: result.pagination,
  });
}

// Example 6: Pagination with includes (relations)
async function testPaginationWithIncludes() {
  console.log("Testing pagination with includes...");

  const result = await trpcCall("v1.documents.list", {
    pagination: { page: 1, limit: 5 },
    include: ["organization"],
  });

  console.log("Pagination with includes result:", {
    itemCount: result.items.length,
    hasOrganization: !!result.items[0]?.organization,
    pagination: result.pagination,
  });
}

// Example 7: Pagination with select (specific fields)
async function testPaginationWithSelect() {
  console.log("Testing pagination with select...");

  const result = await trpcCall("v1.documents.list", {
    pagination: { page: 1, limit: 5 },
    select: ["id", "title", "created_at"],
  });

  console.log("Pagination with select result:", {
    itemCount: result.items.length,
    firstItemKeys: result.items[0] ? Object.keys(result.items[0]) : [],
    pagination: result.pagination,
  });
}

// Example 8: Complex pagination with multiple options
async function testComplexPagination() {
  console.log("Testing complex pagination...");

  const result = await trpcCall("v1.documents.list", {
    pagination: { page: 2, limit: 5 },
    sorting: { orderBy: "created_at", orderDirection: "desc" },
    search: { query: "guide", searchFields: ["title"] },
    filters: { status: "PUBLISHED" },
    dateRange: {
      from: "2024-01-01T00:00:00Z",
    },
  });

  console.log("Complex pagination result:", {
    itemCount: result.items.length,
    pagination: result.pagination,
    currentPage: result.pagination.page,
    hasNext: result.pagination.hasNext,
    hasPrev: result.pagination.hasPrev,
  });
}

// Example 9: Testing conversations pagination
async function testConversationsPagination() {
  console.log("Testing conversations pagination...");

  const result = await trpcCall("v1.conversations.list", {
    pagination: { page: 1, limit: 10 },
    sorting: { orderBy: "created_at", orderDirection: "desc" },
    filters: { status: "open" },
  });

  console.log("Conversations pagination result:", {
    itemCount: result.items.length,
    pagination: result.pagination,
  });
}

// Run all tests
async function _runAllTests() {
  try {
    console.log("🚀 Starting Pagination System Tests\n");

    await testBasicPagination();
    console.log("");

    await testPaginationWithSorting();
    console.log("");

    await testPaginationWithSearch();
    console.log("");

    await testPaginationWithFilters();
    console.log("");

    await testPaginationWithDateRange();
    console.log("");

    await testPaginationWithIncludes();
    console.log("");

    await testPaginationWithSelect();
    console.log("");

    await testComplexPagination();
    console.log("");

    await testConversationsPagination();
    console.log("");

    console.log("✅ All pagination tests completed!");
  } catch (error) {
    console.error("❌ Test failed:", error.response?.data || error.message);
  }
}

// Example JSON input formats for documentation
const exampleInputs = {
  basic: {
    pagination: { page: 1, limit: 20 },
  },

  withSorting: {
    pagination: { page: 1, limit: 20 },
    sorting: { orderBy: "created_at", orderDirection: "desc" },
  },

  withSearch: {
    pagination: { page: 1, limit: 20 },
    search: {
      query: "customer support",
      searchFields: ["title", "content"],
    },
  },

  withFilters: {
    pagination: { page: 1, limit: 20 },
    filters: {
      type: "ARTICLE",
      status: "PUBLISHED",
    },
  },

  withDateRange: {
    pagination: { page: 1, limit: 20 },
    dateRange: {
      from: "2024-01-01T00:00:00Z",
      to: "2024-12-31T23:59:59Z",
    },
  },

  withIncludes: {
    pagination: { page: 1, limit: 20 },
    include: ["organization", "agent"],
  },

  withSelect: {
    pagination: { page: 1, limit: 20 },
    select: ["id", "title", "created_at"],
  },

  complex: {
    pagination: { page: 1, limit: 20 },
    sorting: { orderBy: "created_at", orderDirection: "desc" },
    search: {
      query: "customer support",
      searchFields: ["title", "content"],
    },
    filters: {
      type: "ARTICLE",
      status: "PUBLISHED",
    },
    dateRange: {
      from: "2024-01-01T00:00:00Z",
      to: "2024-12-31T23:59:59Z",
    },
    include: ["organization"],
    select: ["id", "title", "created_at"],
  },
};

console.log("📋 Example Input Formats:");
console.log(JSON.stringify(exampleInputs, null, 2));

// Uncomment to run tests
// _runAllTests();
