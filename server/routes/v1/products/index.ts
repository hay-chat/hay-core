import { t, scopedProcedure, authenticatedProcedure } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AppDataSource } from "@server/database/data-source";
import { Product, ProductSource, ProductStatus } from "@server/entities/product.entity";
import { ProductVariant, VariantAvailability } from "@server/entities/product-variant.entity";
import { productSyncService } from "@server/services/product-sync.service";
import { productVectorStoreService } from "@server/services/product-vector-store.service";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { createLogger } from "@server/lib/logger";
import type { CanonicalProduct } from "@server/types/canonical-product";

const logger = createLogger("products-router");

const variantSchema = z.object({
  externalId: z.string().min(1),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  title: z.string().default("Default"),
  selectedOptions: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
  position: z.number().int().optional(),
  price: z.number().nonnegative().optional(),
  compareAtPrice: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  inventoryQuantity: z.number().int().optional(),
  inventoryTracked: z.boolean().optional(),
  availability: z.nativeEnum(VariantAvailability).optional(),
  weightValue: z.number().optional(),
  weightUnit: z.string().optional(),
  imageSrc: z.string().url().optional(),
  attributes: z.record(z.unknown()).optional(),
});

const canonicalProductSchema = z.object({
  externalId: z.string().min(1),
  source: z.nativeEnum(ProductSource),
  handle: z.string().min(1),
  title: z.string().min(1),
  descriptionHtml: z.string().optional(),
  descriptionShortHtml: z.string().optional(),
  vendor: z.string().optional(),
  productType: z.string().optional(),
  status: z.nativeEnum(ProductStatus).optional(),
  tags: z.array(z.string()).optional(),
  categories: z
    .array(
      z.object({
        externalId: z.string().optional(),
        name: z.string(),
        slug: z.string().optional(),
      }),
    )
    .optional(),
  options: z
    .array(z.object({ name: z.string(), position: z.number().int(), values: z.array(z.string()) }))
    .optional(),
  images: z
    .array(
      z.object({
        src: z.string().url(),
        alt: z.string().optional(),
        position: z.number().int().optional(),
      }),
    )
    .optional(),
  currency: z.string().length(3).optional(),
  sourceUrl: z.string().url().optional(),
  attributes: z.record(z.unknown()).optional(),
  variants: z.array(variantSchema).min(1, "At least one variant is required"),
});

const upsertManyInput = z.object({
  products: z.array(canonicalProductSchema).min(1).max(500),
});

const deleteInput = z.object({
  source: z.nativeEnum(ProductSource),
  externalId: z.string().min(1),
});

const listInput = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
  source: z.nativeEnum(ProductSource).optional(),
  available: z.boolean().optional(),
  query: z.string().optional(),
});

const idInput = z.object({ id: z.string().uuid() });

export const productsRouter = t.router({
  /**
   * Bulk-upsert canonical products. Idempotent on (source, externalId).
   * Auth: any caller with `products:create` (or full-access). Works for
   * dashboard users and for API-key callers driving custom-store ingestion.
   */
  upsertMany: scopedProcedure(RESOURCES.PRODUCTS, ACTIONS.CREATE)
    .input(upsertManyInput)
    .mutation(async ({ input, ctx }) => {
      const organizationId = ctx.organizationId;
      if (!organizationId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Organization ID is required" });
      }

      logger.info({ organizationId, count: input.products.length }, "Bulk-upserting products");
      const result = await productSyncService.upsertProducts(
        organizationId,
        input.products as CanonicalProduct[],
      );
      return result;
    }),

  /**
   * Single-product upsert (webhook-driven refresh).
   */
  upsert: scopedProcedure(RESOURCES.PRODUCTS, ACTIONS.CREATE)
    .input(canonicalProductSchema)
    .mutation(async ({ input, ctx }) => {
      const organizationId = ctx.organizationId;
      if (!organizationId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Organization ID is required" });
      }
      return await productSyncService.upsertProduct(organizationId, input as CanonicalProduct);
    }),

  delete: scopedProcedure(RESOURCES.PRODUCTS, ACTIONS.DELETE)
    .input(deleteInput)
    .mutation(async ({ input, ctx }) => {
      const organizationId = ctx.organizationId;
      if (!organizationId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Organization ID is required" });
      }
      const removed = await productSyncService.deleteProductByExternalId(
        organizationId,
        input.source,
        input.externalId,
      );
      return { removed };
    }),

  list: scopedProcedure(RESOURCES.PRODUCTS, ACTIONS.READ)
    .input(listInput)
    .query(async ({ input, ctx }) => {
      const organizationId = ctx.organizationId;
      if (!organizationId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Organization ID is required" });
      }
      const repo = AppDataSource.getRepository(Product);
      const qb = repo
        .createQueryBuilder("p")
        .where("p.organizationId = :organizationId", { organizationId });

      if (input.source) qb.andWhere("p.source = :source", { source: input.source });
      if (typeof input.available === "boolean") {
        qb.andWhere("p.available = :available", { available: input.available });
      }
      if (input.query) {
        qb.andWhere("(p.title ILIKE :q OR p.handle ILIKE :q)", {
          q: `%${input.query}%`,
        });
      }

      qb.orderBy("p.updatedAt", "DESC").skip(input.offset).take(input.limit);

      const [rows, total] = await qb.getManyAndCount();
      return { rows, total };
    }),

  byId: scopedProcedure(RESOURCES.PRODUCTS, ACTIONS.READ)
    .input(idInput)
    .query(async ({ input, ctx }) => {
      const organizationId = ctx.organizationId;
      if (!organizationId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Organization ID is required" });
      }
      const product = await AppDataSource.getRepository(Product).findOne({
        where: { id: input.id, organizationId },
      });
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });

      const variants = await AppDataSource.getRepository(ProductVariant).find({
        where: { organizationId, productId: product.id },
        order: { position: "ASC" },
      });

      return { product, variants };
    }),

  stats: authenticatedProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.organizationId;
    if (!organizationId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Organization ID is required" });
    }
    const [products, embeddingStats] = await Promise.all([
      AppDataSource.getRepository(Product).count({ where: { organizationId } }),
      productVectorStoreService.getStatistics(organizationId),
    ]);
    return { products, embeddings: embeddingStats };
  }),
});
