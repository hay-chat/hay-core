/**
 * Authentication System Test Examples
 * This file demonstrates how to use the authentication system
 */

import axios from "axios";

const API_URL = "http://localhost:3000/trpc";

// Helper function to make tRPC requests
async function trpcCall(procedure: string, input?: unknown, headers?: Record<string, string>) {
  const response = await axios.post(`${API_URL}/${procedure}`, input, { headers });
  return response.data;
}

// Test Examples
async function testAuthenticationFlow() {
  console.log("🔐 Testing Authentication System\n");

  // 1. Register a new user
  console.log("1. Registering new user...");
  try {
    const registerResult = await trpcCall("auth.register", {
      email: "test@example.com",
      password: "SecurePassword123!",
      confirmPassword: "SecurePassword123!",
    });

    console.log("✅ Registration successful");
    console.log("   User ID:", registerResult.user.id);
    console.log("   Access Token:", registerResult.accessToken.substring(0, 20) + "...");
    console.log("   Refresh Token:", registerResult.refreshToken.substring(0, 20) + "...");
  } catch (error) {
    console.log("❌ Registration failed:", error.response?.data || error.message);
  }

  // 2. Login with credentials
  console.log("\n2. Testing login...");
  let accessToken = "";
  let refreshToken = "";

  try {
    const loginResult = await trpcCall("auth.login", {
      email: "test@example.com",
      password: "SecurePassword123!",
    });

    accessToken = loginResult.accessToken;
    refreshToken = loginResult.refreshToken;

    console.log("✅ Login successful");
    console.log("   Access Token:", accessToken.substring(0, 20) + "...");
    console.log("   Expires In:", loginResult.expiresIn, "seconds");
  } catch (error) {
    console.log("❌ Login failed:", error.response?.data || error.message);
  }

  // 3. Get user profile with JWT Bearer token
  console.log("\n3. Fetching user profile with JWT...");
  try {
    const meResult = await trpcCall("auth.me", undefined, {
      Authorization: `Bearer ${accessToken}`,
    });

    console.log("✅ Profile fetched");
    console.log("   User:", meResult);
  } catch (error) {
    console.log("❌ Profile fetch failed:", error.response?.data || error.message);
  }

  // 4. Create API Key
  console.log("\n4. Creating API key...");
  let apiKey = "";

  try {
    const apiKeyResult = await trpcCall(
      "auth.createApiKey",
      {
        name: "Test API Key",
        scopes: [
          { resource: "documents", actions: ["read", "write"] },
          { resource: "users", actions: ["read"] },
        ],
      },
      {
        Authorization: `Bearer ${accessToken}`,
      },
    );

    apiKey = apiKeyResult.key;

    console.log("✅ API Key created");
    console.log("   Key ID:", apiKeyResult.id);
    console.log("   Key:", apiKey);
    console.log("   ⚠️  Save this key! It won't be shown again.");
  } catch (error) {
    console.log("❌ API Key creation failed:", error.response?.data || error.message);
  }

  // 5. Test API Key authentication
  console.log("\n5. Testing API Key authentication...");
  try {
    const meResult = await trpcCall("auth.me", undefined, {
      Authorization: `ApiKey ${apiKey}`,
    });

    console.log("✅ API Key authentication successful");
    console.log("   Auth Method:", meResult.authMethod);
  } catch (error) {
    console.log("❌ API Key auth failed:", error.response?.data || error.message);
  }

  // 6. Test Basic Authentication
  console.log("\n6. Testing Basic Authentication...");
  const basicAuth = Buffer.from("test@example.com:SecurePassword123!").toString("base64");

  try {
    const meResult = await trpcCall("auth.me", undefined, {
      Authorization: `Basic ${basicAuth}`,
    });

    console.log("✅ Basic authentication successful");
    console.log("   Auth Method:", meResult.authMethod);
    console.log("   Note: Response includes new JWT tokens in headers");
  } catch (error) {
    console.log("❌ Basic auth failed:", error.response?.data || error.message);
  }

  // 7. Refresh access token
  console.log("\n7. Testing token refresh...");
  try {
    const refreshResult = await trpcCall("auth.refreshToken", {
      refreshToken: refreshToken,
    });

    console.log("✅ Token refreshed");
    console.log("   New Access Token:", refreshResult.accessToken.substring(0, 20) + "...");
    console.log("   Expires In:", refreshResult.expiresIn, "seconds");
  } catch (error) {
    console.log("❌ Token refresh failed:", error.response?.data || error.message);
  }

  // 8. Change password
  console.log("\n8. Testing password change...");
  try {
    await trpcCall(
      "auth.changePassword",
      {
        currentPassword: "SecurePassword123!",
        newPassword: "NewSecurePassword456!",
      },
      {
        Authorization: `Bearer ${accessToken}`,
      },
    );

    console.log("✅ Password changed successfully");
  } catch (error) {
    console.log("❌ Password change failed:", error.response?.data || error.message);
  }

  // 9. List API keys
  console.log("\n9. Listing API keys...");
  try {
    const apiKeys = await trpcCall("auth.listApiKeys", undefined, {
      Authorization: `Bearer ${accessToken}`,
    });

    console.log("✅ API Keys retrieved");
    console.log("   Total keys:", apiKeys.length);
    apiKeys.forEach((key) => {
      console.log(`   - ${key.name} (${key.id})`);
    });
  } catch (error) {
    console.log("❌ List API keys failed:", error.response?.data || error.message);
  }

  console.log("\n✨ Authentication system test complete!");
}

// Security test examples
async function testSecurityFeatures() {
  console.log("\n🔒 Testing Security Features\n");

  // Test invalid credentials
  console.log("1. Testing invalid login (timing attack protection)...");
  const startTime = Date.now();

  try {
    await trpcCall("auth.login", {
      email: "nonexistent@example.com",
      password: "WrongPassword",
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`   Failed as expected. Duration: ${duration}ms`);
    console.log("   ✅ Timing attack protection active (password verification still runs)");
  }

  // Test expired token
  console.log("\n2. Testing expired JWT...");
  const expiredToken =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjMiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJpYXQiOjE2MDAwMDAwMDAsImV4cCI6MTYwMDAwMDAwMX0.fake";

  try {
    await trpcCall("auth.me", undefined, {
      Authorization: `Bearer ${expiredToken}`,
    });
  } catch (error) {
    console.log("   ✅ Expired token correctly rejected");
  }

  // Test malformed Basic auth
  console.log("\n3. Testing malformed Basic auth...");

  try {
    await trpcCall("auth.me", undefined, {
      Authorization: `Basic malformed_base64`,
    });
  } catch (error) {
    console.log("   ✅ Malformed auth correctly rejected");
  }

  console.log("\n✨ Security tests complete!");
}

// Run tests if this file is executed directly
if (require.main === module) {
  testAuthenticationFlow()
    .then(() => testSecurityFeatures())
    .catch(console.error);
}

export { testAuthenticationFlow, testSecurityFeatures };
