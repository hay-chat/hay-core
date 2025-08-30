import axios from 'axios';
import { config } from 'dotenv';

// Load environment variables
config({ path: '.env' });

const API_URL = 'http://localhost:3000/v1';
const AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || ''; // You'll need to set this
const ORGANIZATION_ID = process.env.TEST_ORGANIZATION_ID || ''; // You'll need to set this

async function addSampleDocuments() {
  console.log('Adding sample documents to knowledge base...');
  
  const documents = [
    {
      content: "To add a constituent in our CRM system, navigate to the Constituents module from the main dashboard. Click on the 'Add New Constituent' button in the top right corner. Fill in the required fields including First Name, Last Name, Email, and Phone Number. Optional fields include Address, Date of Birth, and any custom tags. Click 'Save' to create the new constituent record.",
      metadata: {
        source: "CRM User Guide",
        category: "constituent_management",
        keywords: ["constituent", "add", "create", "CRM"]
      }
    },
    {
      content: "Constituent records can be edited by clicking on the constituent's name in the list view. This opens the constituent detail page where you can modify any field. Remember to click 'Save Changes' after making updates. You can also add notes, activities, and relationships from the constituent detail page.",
      metadata: {
        source: "CRM User Guide",
        category: "constituent_management",
        keywords: ["constituent", "edit", "update", "modify"]
      }
    },
    {
      content: "To search for constituents, use the search bar at the top of the Constituents module. You can search by name, email, phone number, or any custom field. Advanced search options allow filtering by tags, date ranges, and activity history.",
      metadata: {
        source: "CRM User Guide",
        category: "constituent_management",
        keywords: ["constituent", "search", "find", "filter"]
      }
    },
    {
      content: "Our organization's mission is to provide exceptional customer service and build lasting relationships with our constituents. We value transparency, integrity, and continuous improvement in all our interactions.",
      metadata: {
        source: "Organization Handbook",
        category: "about",
        keywords: ["mission", "values", "organization"]
      }
    },
    {
      content: "For technical support, please contact our help desk at support@example.com or call 1-800-HELP-NOW. Support hours are Monday through Friday, 9 AM to 6 PM EST. For urgent issues outside of business hours, use the emergency support portal.",
      metadata: {
        source: "Support Documentation",
        category: "support",
        keywords: ["help", "support", "contact", "assistance"]
      }
    }
  ];

  try {
    for (const doc of documents) {
      const response = await axios.post(
        `${API_URL}/embeddings.add`,
        doc,
        {
          headers: {
            'Authorization': `Bearer ${AUTH_TOKEN}`,
            'x-organization-id': ORGANIZATION_ID,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log(`✅ Added document: ${doc.metadata?.source} - ${doc.metadata?.category}`);
      console.log(`   Created ${response.data.result.count} embedding(s)`);
    }
    
    console.log('\n✅ All sample documents added successfully!');
  } catch (error: any) {
    console.error('❌ Error adding documents:', error.response?.data || error.message);
  }
}

async function testSearch(query: string) {
  console.log(`\n🔍 Searching for: "${query}"`);
  
  try {
    const response = await axios.post(
      `${API_URL}/embeddings.search`,
      {
        query,
        limit: 3
      },
      {
        headers: {
          'Authorization': `Bearer ${AUTH_TOKEN}`,
          'x-organization-id': ORGANIZATION_ID,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const results = response.data.result.results;
    
    if (results.length === 0) {
      console.log('   No results found');
    } else {
      console.log(`   Found ${results.length} result(s):\n`);
      results.forEach((result: any, index: number) => {
        console.log(`   ${index + 1}. [Similarity: ${(result.similarity * 100).toFixed(1)}%]`);
        console.log(`      ${result.content.substring(0, 150)}...`);
        if (result.metadata?.source) {
          console.log(`      Source: ${result.metadata.source}`);
        }
        console.log('');
      });
    }
  } catch (error: any) {
    console.error('❌ Error searching:', error.response?.data || error.message);
  }
}

async function getStats() {
  console.log('\n📊 Getting embedding statistics...');
  
  try {
    const response = await axios.get(
      `${API_URL}/embeddings.stats`,
      {
        headers: {
          'Authorization': `Bearer ${AUTH_TOKEN}`,
          'x-organization-id': ORGANIZATION_ID
        }
      }
    );
    
    const stats = response.data.result;
    console.log(`   Total embeddings: ${stats.totalEmbeddings}`);
    console.log(`   Total documents: ${stats.totalDocuments}`);
    console.log(`   Avg embeddings per document: ${stats.avgEmbeddingsPerDocument}`);
  } catch (error: any) {
    console.error('❌ Error getting stats:', error.response?.data || error.message);
  }
}

async function main() {
  if (!AUTH_TOKEN || !ORGANIZATION_ID) {
    console.error('❌ Please set TEST_AUTH_TOKEN and TEST_ORGANIZATION_ID environment variables');
    console.log('\nTo get these values:');
    console.log('1. Start the server: cd server && npm run dev');
    console.log('2. Login via the dashboard');
    console.log('3. Check the network tab for the Authorization header and x-organization-id header');
    process.exit(1);
  }

  console.log('🚀 Starting RAG system test...\n');
  console.log(`API URL: ${API_URL}`);
  console.log(`Organization ID: ${ORGANIZATION_ID}\n`);

  // Add sample documents
  await addSampleDocuments();
  
  // Wait a bit for indexing
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test various searches
  await testSearch("How do I add a constituent?");
  await testSearch("What are the support hours?");
  await testSearch("constituent management");
  await testSearch("organization mission values");
  await testSearch("emergency contact");
  
  // Get statistics
  await getStats();
  
  console.log('\n✅ RAG system test completed!');
}

// Run the test
main().catch(console.error);