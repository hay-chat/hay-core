import { t, authenticatedProcedure } from "@server/trpc";
import { z } from "zod";
import { CustomerService } from "../../../services/customer.service";
import { TRPCError } from "@trpc/server";
import { createListProcedure } from "@server/trpc/procedures/list";
import { CustomerRepository } from "@server/repositories/customer.repository";

const customerService = new CustomerService();
const customerRepository = new CustomerRepository();

const createCustomerSchema = z.object({
  external_id: z.string().min(1).max(255).nullish(),
  email: z.string().email().max(255).nullish(),
  phone: z.string().max(50).nullish(),
  name: z.string().max(255).nullish(),
  notes: z.string().nullish(),
  external_metadata: z.record(z.any()).nullish(),
});

const updateCustomerSchema = z.object({
  external_id: z.string().min(1).max(255).nullish(),
  email: z.string().email().max(255).nullish(),
  phone: z.string().max(50).nullish(),
  name: z.string().max(255).nullish(),
  notes: z.string().nullish(),
  external_metadata: z.record(z.any()).nullish(),
});

const mergeCustomersSchema = z.object({
  sourceCustomerId: z.string().uuid(),
  targetCustomerId: z.string().uuid(),
});

const customerListInputSchema = z.object({
  pagination: z
    .object({
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
    })
    .default({ page: 1, limit: 20 }),
  filters: z
    .object({
      email: z.string().optional(),
      externalId: z.string().optional(),
      hasConversations: z.boolean().optional(),
    })
    .optional(),
  search: z
    .object({
      query: z.string().optional(),
      searchFields: z.array(z.string()).optional(),
    })
    .optional(),
  sorting: z
    .object({
      orderBy: z.string().optional(),
      orderDirection: z.enum(["asc", "desc"]).default("desc"),
    })
    .default({ orderDirection: "desc" }),
  dateRange: z
    .object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    })
    .optional(),
  include: z.array(z.string()).optional(),
  select: z.array(z.string()).optional(),
});

export const customersRouter = t.router({
  list: createListProcedure(customerListInputSchema, customerRepository),

  get: authenticatedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const customer = await customerService.getCustomer(input.id, ctx.organizationId!);

      if (!customer) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Customer not found",
        });
      }

      return customer;
    }),

  getByExternalId: authenticatedProcedure
    .input(z.object({ externalId: z.string() }))
    .query(async ({ ctx, input }) => {
      const customer = await customerService.getCustomerByExternalId(
        input.externalId,
        ctx.organizationId!,
      );

      if (!customer) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Customer not found",
        });
      }

      return customer;
    }),

  getByEmail: authenticatedProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ ctx, input }) => {
      const customer = await customerService.getCustomerByEmail(input.email, ctx.organizationId!);

      if (!customer) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Customer not found",
        });
      }

      return customer;
    }),

  create: authenticatedProcedure.input(createCustomerSchema).mutation(async ({ ctx, input }) => {
    try {
      const customer = await customerService.createCustomer(ctx.organizationId!, {
        external_id: input.external_id || null,
        email: input.email || null,
        phone: input.phone || null,
        name: input.name || null,
        notes: input.notes || null,
        external_metadata: input.external_metadata || null,
      });
      return customer;
    } catch (error: any) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error.message,
      });
    }
  }),

  createAnonymous: authenticatedProcedure.mutation(async ({ ctx }) => {
    const customer = await customerService.createAnonymousCustomer(ctx.organizationId!);
    return customer;
  }),

  findOrCreate: authenticatedProcedure
    .input(createCustomerSchema)
    .mutation(async ({ ctx, input }) => {
      const customer = await customerService.findOrCreateCustomer(ctx.organizationId!, {
        external_id: input.external_id || null,
        email: input.email || null,
        phone: input.phone || null,
        name: input.name || null,
        notes: input.notes || null,
        external_metadata: input.external_metadata || null,
      });
      return customer;
    }),

  update: authenticatedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: updateCustomerSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const customer = await customerService.updateCustomer(input.id, ctx.organizationId!, {
          external_id: input.data.external_id,
          email: input.data.email,
          phone: input.data.phone,
          name: input.data.name,
          notes: input.data.notes,
          external_metadata: input.data.external_metadata,
        });

        if (!customer) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Customer not found",
          });
        }

        return customer;
      } catch (error: any) {
        if (error.code === "NOT_FOUND") {
          throw error;
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error.message,
        });
      }
    }),

  delete: authenticatedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await customerService.deleteCustomer(input.id, ctx.organizationId!);

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Customer not found",
        });
      }

      return { success: true };
    }),

  merge: authenticatedProcedure.input(mergeCustomersSchema).mutation(async ({ ctx, input }) => {
    const mergedCustomer = await customerService.mergeCustomers(
      input.sourceCustomerId,
      input.targetCustomerId,
      ctx.organizationId!,
    );

    if (!mergedCustomer) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "One or both customers not found",
      });
    }

    return mergedCustomer;
  }),
});
