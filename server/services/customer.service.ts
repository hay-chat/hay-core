import { CustomerRepository } from "../repositories/customer.repository";
import { Customer } from "../database/entities/customer.entity";
import type { ExternalMetadata } from "../database/entities/customer.entity";

export class CustomerService {
  private customerRepository: CustomerRepository;

  constructor() {
    this.customerRepository = new CustomerRepository();
  }

  /**
   * Create a new customer
   */
  async createCustomer(
    organizationId: string,
    data: {
      external_id?: string | null;
      email?: string | null;
      phone?: string | null;
      name?: string | null;
      notes?: string | null;
      external_metadata?: ExternalMetadata | null;
    },
  ): Promise<Customer> {
    // Check if customer with external_id already exists
    if (data.external_id) {
      const existingCustomer = await this.customerRepository.findByExternalId(
        data.external_id,
        organizationId,
      );
      if (existingCustomer) {
        throw new Error(`Customer with external_id ${data.external_id} already exists`);
      }
    }

    return await this.customerRepository.create({
      organization_id: organizationId,
      external_id: data.external_id || null,
      email: data.email || null,
      phone: data.phone || null,
      name: data.name || null,
      notes: data.notes || null,
      external_metadata: data.external_metadata || null,
    });
  }

  /**
   * Create an anonymous customer (all fields empty)
   */
  async createAnonymousCustomer(organizationId: string): Promise<Customer> {
    return await this.customerRepository.create({
      organization_id: organizationId,
      external_id: null,
      email: null,
      phone: null,
      name: null,
      notes: null,
      external_metadata: null,
    });
  }

  /**
   * Get a customer by ID
   */
  async getCustomer(customerId: string, organizationId: string): Promise<Customer | null> {
    const customer = await this.customerRepository.findById(customerId);
    if (!customer || customer.organization_id !== organizationId) {
      return null;
    }
    return customer;
  }

  /**
   * Get a customer by external ID
   */
  async getCustomerByExternalId(
    externalId: string,
    organizationId: string,
  ): Promise<Customer | null> {
    return await this.customerRepository.findByExternalId(externalId, organizationId);
  }

  /**
   * Get a customer by email
   */
  async getCustomerByEmail(email: string, organizationId: string): Promise<Customer | null> {
    return await this.customerRepository.findByEmail(email, organizationId);
  }

  /**
   * Get all customers for an organization
   */
  async getCustomers(organizationId: string): Promise<Customer[]> {
    return await this.customerRepository.findByOrganization(organizationId);
  }

  /**
   * Update a customer
   */
  async updateCustomer(
    customerId: string,
    organizationId: string,
    data: {
      external_id?: string | null;
      email?: string | null;
      phone?: string | null;
      name?: string | null;
      notes?: string | null;
      external_metadata?: ExternalMetadata | null;
    },
  ): Promise<Customer | null> {
    // Check if updating external_id to one that already exists
    if (data.external_id !== undefined) {
      const existingCustomer = await this.customerRepository.findByExternalId(
        data.external_id!,
        organizationId,
      );
      if (existingCustomer && existingCustomer.id !== customerId) {
        throw new Error(`Customer with external_id ${data.external_id} already exists`);
      }
    }

    return await this.customerRepository.update(customerId, organizationId, data);
  }

  /**
   * Delete a customer
   */
  async deleteCustomer(customerId: string, organizationId: string): Promise<boolean> {
    return await this.customerRepository.delete(customerId, organizationId);
  }

  /**
   * Merge two customers
   * Transfers all conversations from source to target and deletes source
   */
  async mergeCustomers(
    sourceCustomerId: string,
    targetCustomerId: string,
    organizationId: string,
  ): Promise<Customer | null> {
    return await this.customerRepository.mergeCustomers(
      sourceCustomerId,
      targetCustomerId,
      organizationId,
    );
  }

  /**
   * Find or create a customer based on external_id or email
   * Returns existing customer if found, creates new one if not
   */
  async findOrCreateCustomer(
    organizationId: string,
    data: {
      external_id?: string | null;
      email?: string | null;
      phone?: string | null;
      name?: string | null;
      notes?: string | null;
      external_metadata?: ExternalMetadata | null;
    },
  ): Promise<Customer> {
    // Try to find by external_id first
    if (data.external_id) {
      const existingCustomer = await this.customerRepository.findByExternalId(
        data.external_id,
        organizationId,
      );
      if (existingCustomer) {
        // Update with any new data provided
        const updatedCustomer = await this.updateCustomer(existingCustomer.id, organizationId, {
          email: data.email || existingCustomer.email,
          phone: data.phone || existingCustomer.phone,
          name: data.name || existingCustomer.name,
          notes: data.notes || existingCustomer.notes,
          external_metadata: data.external_metadata || existingCustomer.external_metadata,
        });
        return updatedCustomer!;
      }
    }

    // Try to find by email if no external_id match
    if (data.email) {
      const existingCustomer = await this.customerRepository.findByEmail(
        data.email,
        organizationId,
      );
      if (existingCustomer) {
        // Update with any new data provided
        const updatedCustomer = await this.updateCustomer(existingCustomer.id, organizationId, {
          external_id: data.external_id || existingCustomer.external_id,
          phone: data.phone || existingCustomer.phone,
          name: data.name || existingCustomer.name,
          notes: data.notes || existingCustomer.notes,
          external_metadata: data.external_metadata || existingCustomer.external_metadata,
        });
        return updatedCustomer!;
      }
    }

    // No existing customer found, create new one
    return await this.createCustomer(organizationId, data);
  }
}
