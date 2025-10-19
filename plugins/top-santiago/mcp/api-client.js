import axios from 'axios';

/**
 * Top Santiago API Client
 *
 * Handles all HTTP requests to the Top Santiago API
 * Base URL: https://api.sandbox.topsantiago.com
 * Authentication: x-api-key header
 */

class TopSantiagoClient {
  constructor() {
    this.baseURL = process.env.TOP_SANTIAGO_API_URL || 'https://api.sandbox.topsantiago.com';
    this.apiKey = process.env.TOP_SANTIAGO_API_KEY;

    if (!this.apiKey) {
      console.error('[Top Santiago] Warning: API key not configured. Set TOP_SANTIAGO_API_KEY environment variable.');
    }

    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey
      },
      timeout: 30000 // 30 second timeout
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      response => response,
      error => {
        console.error('[Top Santiago] API Error:', error.response?.data || error.message);
        throw error;
      }
    );
  }

  // ==================== ADDRESS ENDPOINTS ====================

  /**
   * Fetch addresses with filters
   * GET /v1/address
   */
  async listAddresses({ search, description, streetName, locality, council, offset = 0, limit = 10 } = {}) {
    const params = {};
    if (search) params.search = search;
    if (description) params.description = description;
    if (streetName) params.streetName = streetName;
    if (locality) params.locality = locality;
    if (council) params.council = council;
    params.offset = offset;
    params.limit = limit;

    const response = await this.client.get('/v1/address', { params });
    return response.data;
  }

  /**
   * Retrieve an address by ID
   * GET /v1/address/{id}
   */
  async getAddress(id) {
    const response = await this.client.get(`/v1/address/${id}`);
    return response.data;
  }

  // ==================== SUBSCRIPTION ENDPOINTS ====================

  /**
   * Fetch subscriptions with filters
   * GET /v1/subscription
   */
  async listSubscriptions({ name, contact, email, offset = 0, limit = 10 } = {}) {
    const params = {};
    if (name) params.name = name;
    if (contact) params.contact = contact;
    if (email) params.email = email;
    params.offset = offset;
    params.limit = limit;

    const response = await this.client.get('/v1/subscription', { params });
    return response.data;
  }

  /**
   * Retrieve a subscription by ID
   * GET /v1/subscription/{id}
   */
  async getSubscription(id) {
    const response = await this.client.get(`/v1/subscription/${id}`);
    return response.data;
  }

  /**
   * Create a new subscription
   * POST /v1/subscription
   */
  async createSubscription(data) {
    const response = await this.client.post('/v1/subscription', data);
    return response.data;
  }

  /**
   * Update a subscription by ID (full update)
   * PUT /v1/subscription/{id}
   */
  async updateSubscription(id, data) {
    const response = await this.client.put(`/v1/subscription/${id}`, data);
    return response.data;
  }

  /**
   * Patch a subscription by ID (partial update)
   * PATCH /v1/subscription/{id}
   */
  async patchSubscription(id, data) {
    const response = await this.client.patch(`/v1/subscription/${id}`, data);
    return response.data;
  }

  /**
   * Delete a subscription by ID
   * DELETE /v1/subscription/{id}
   */
  async deleteSubscription(id) {
    const response = await this.client.delete(`/v1/subscription/${id}`);
    return response.status === 204 ? { success: true, message: 'Subscription deleted successfully' } : response.data;
  }

  // ==================== AUTH ENDPOINTS (Internal Use) ====================

  /**
   * Create new API agency token
   * POST /v1/auth
   * Restricted - Top Santiago internal use only
   */
  async createAPIToken(data) {
    const response = await this.client.post('/v1/auth', data);
    return response.data;
  }

  // ==================== USER ENDPOINTS (Internal Use) ====================

  /**
   * Create new User
   * POST /v1/user
   * Restricted - Top Santiago internal use only
   */
  async createUser(data) {
    const response = await this.client.post('/v1/user', data);
    return response.data;
  }

  // ==================== AGENCY ENDPOINTS (Internal Use) ====================

  /**
   * Create a new agency
   * POST /v1/agency
   * Restricted - Top Santiago internal use only
   */
  async createAgency(data) {
    const response = await this.client.post('/v1/agency', data);
    return response.data;
  }
}

// Export singleton instance
export const topSantiagoClient = new TopSantiagoClient();
