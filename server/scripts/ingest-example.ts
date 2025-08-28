#!/usr/bin/env ts-node

/**
 * Example script for ingesting documents into the vector store
 * 
 * Usage:
 *   ORGANIZATION_ID=<org-uuid> DOCUMENT_ID=<doc-uuid> ts-node scripts/ingest-example.ts
 * 
 * Environment variables required:
 *   - ORGANIZATION_ID: UUID of the organization
 *   - DOCUMENT_ID: UUID of the document (optional)
 *   - OPENAI_API_KEY: OpenAI API key for embeddings
 *   - EMBEDDING_DIM: Embedding dimensions (default: 1536)
 */

import "reflect-metadata";
import { AppDataSource } from "../database/data-source";
import { vectorStoreService } from "../services/vector-store.service";
import type { VectorChunk } from "../services/vector-store.service";

// Sample text for testing
const SAMPLE_TEXT = `
# Vector Store Documentation

## Overview
This vector store implementation uses pgvector for efficient similarity search.
It integrates with LangChain's TypeORMVectorStore for seamless embedding management.

## Features
- Multi-tenant support with organization-based isolation
- Cosine similarity search with HNSW indexing
- Integration with OpenAI embeddings (text-embedding-3-small)
- Document-level association for embeddings
- Scalable architecture with support for partitioning

## Usage
The vector store service provides methods for:
1. Adding text chunks with metadata
2. Searching for similar content within an organization
3. Managing embeddings lifecycle
4. Retrieving statistics and analytics

## Performance
The HNSW index provides approximate nearest neighbor search with:
- Fast query times even with millions of vectors
- Configurable trade-offs between speed and accuracy
- Support for partial indexes for large organizations

## Security
- Row-level security (RLS) support for Supabase deployments
- Organization-scoped queries ensure data isolation
- JWT-based authentication integration
`;

// Function to split text into chunks
function splitTextIntoChunks(text: string, chunkSize: number = 500): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > chunkSize && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

async function main() {
  try {
    // Get environment variables
    let orgId = process.env.ORGANIZATION_ID;
    let docId = process.env.DOCUMENT_ID || null;

    if (!orgId) {
      console.warn("⚠️  ORGANIZATION_ID not provided, creating test organization");
    }

    // Initialize database connection
    console.log("\n⏳ Initializing database connection...");
    await AppDataSource.initialize();
    console.log("✅ Database connected");

    // Create test organization and document if not provided
    if (!orgId) {
      const orgResult = await AppDataSource.query(`
        INSERT INTO organizations (name, slug, "isActive") 
        VALUES ('Test Organization', 'test-org-' || gen_random_uuid(), true)
        RETURNING id
      `);
      orgId = orgResult[0].id;
      console.log(`✅ Created test organization: ${orgId}`);
    }

    if (!docId && process.env.CREATE_DOCUMENT === "true") {
      const docResult = await AppDataSource.query(`
        INSERT INTO documents ("organizationId", title, description) 
        VALUES ($1, 'Test Document', 'Created for vector store example')
        RETURNING id
      `, [orgId]);
      docId = docResult[0].id;
      console.log(`✅ Created test document: ${docId}`);
    }

    console.log("\n🚀 Starting vector store ingestion example");
    console.log(`📁 Organization ID: ${orgId}`);
    console.log(`📄 Document ID: ${docId || "Not specified"}`);

    // Initialize vector store service
    console.log("\n⏳ Initializing vector store service...");
    await vectorStoreService.initialize();
    console.log("✅ Vector store initialized");

    // Split text into chunks
    console.log("\n📝 Splitting text into chunks...");
    const textChunks = splitTextIntoChunks(SAMPLE_TEXT, 500);
    console.log(`✅ Created ${textChunks.length} chunks`);

    // Prepare chunks with metadata
    const chunks: VectorChunk[] = textChunks.map((content, index) => ({
      content,
      metadata: {
        chunkIndex: index,
        source: "example-script",
        timestamp: new Date().toISOString(),
        type: "documentation",
      },
    }));

    // Add chunks to vector store
    console.log("\n⏳ Adding chunks to vector store...");
    const embeddingIds = await vectorStoreService.addChunks(orgId!, docId, chunks);
    console.log(`✅ Added ${embeddingIds.length} embeddings`);
    console.log("Embedding IDs:", embeddingIds.slice(0, 3), "...");

    // Test search functionality
    console.log("\n🔍 Testing search functionality...");
    const searchQueries = [
      "How does the vector store handle multi-tenancy?",
      "What indexing method is used for similarity search?",
      "Tell me about performance optimization",
    ];

    for (const query of searchQueries) {
      console.log(`\n📍 Query: "${query}"`);
      const results = await vectorStoreService.search(orgId!, query, 3);
      
      if (results.length > 0) {
        console.log(`Found ${results.length} results:`);
        results.forEach((result, index) => {
          console.log(`  ${index + 1}. [Similarity: ${(result.similarity! * 100).toFixed(2)}%]`);
          console.log(`     ${result.content.substring(0, 100)}...`);
        });
      } else {
        console.log("  No results found");
      }
    }

    // Get statistics
    console.log("\n📊 Getting statistics...");
    const stats = await vectorStoreService.getStatistics(orgId!);
    console.log("Statistics:", stats);

    // Optional: Clean up test data
    if (process.env.CLEANUP === "true") {
      console.log("\n🧹 Cleaning up test data...");
      if (docId) {
        const deleted = await vectorStoreService.deleteByDocumentId(orgId!, docId);
        console.log(`✅ Deleted ${deleted} embeddings`);
      }
    }

    console.log("\n✨ Example completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

// Run the example
main().catch(console.error);