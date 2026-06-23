import { t, scopedProcedure, authenticatedProcedure } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AppDataSource } from "@server/database/data-source";
import { Product, ProductStatus, CORE_PRODUCT_SOURCES } from "@server/entities/product.entity";
import { ProductVariant, VariantAvailability } from "@server/entities/product-variant.entity";
import { productSyncService } from "@server/services/product-sync.service";
import { productVectorStoreService } from "@server/services/product-vector-store.service";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { createLogger } from "@server/lib/logger";
import type { CanonicalProduct } from "@server/types/canonical-product";

const logger = createLogger("products-router");

// This route is a CORE-owned ingestion path (public custom-store API + manual
// dashboard entry), so it may name its own sources — but ONLY core's two, never
// a plugin id. Plugin catalogs flow through pluginApi.products.* instead.
const coreSourceSchema = z
  .enum([CORE_PRODUCT_SOURCES.CUSTOM, CORE_PRODUCT_SOURCES.MANUAL])
  .default(CORE_PRODUCT_SOURCES.CUSTOM);

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
  source: coreSourceSchema,
});

const upsertOneInput = z.object({
  product: canonicalProductSchema,
  source: coreSourceSchema,
});

const deleteInput = z.object({
  source: z.enum([CORE_PRODUCT_SOURCES.CUSTOM, CORE_PRODUCT_SOURCES.MANUAL]),
  externalId: z.string().min(1),
});

const listInput = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
  // Free-form source filter (a plugin id or a core source) — not enumerated.
  source: z.string().optional(),
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

      logger.info(
        { organizationId, count: input.products.length, source: input.source },
        "Bulk-upserting products",
      );
      const result = await productSyncService.upsertProducts(
        organizationId,
        input.products as CanonicalProduct[],
        input.source,
      );
      return result;
    }),

  /**
   * Single-product upsert (webhook-driven refresh).
   */
  upsert: scopedProcedure(RESOURCES.PRODUCTS, ACTIONS.CREATE)
    .input(upsertOneInput)
    .mutation(async ({ input, ctx }) => {
      const organizationId = ctx.organizationId;
      if (!organizationId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Organization ID is required" });
      }
      return await productSyncService.upsertProduct(
        organizationId,
        input.product as CanonicalProduct,
        input.source,
      );
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

  /**
   * Distinct sources actually present in this org's catalog, each with a
   * display label. Plugin-id sources are resolved to the plugin's name via the
   * registry (dynamic discovery — core never hardcodes the list); the two
   * core-owned sources get static labels. Drives the dashboard source filter so
   * it only ever shows sources that exist, never a hardcoded plugin roster.
   */
  sources: authenticatedProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.organizationId;
    if (!organizationId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Organization ID is required" });
    }

    const rows = await AppDataSource.getRepository(Product)
      .createQueryBuilder("p")
      .select("DISTINCT p.source", "source")
      .where("p.organizationId = :organizationId", { organizationId })
      .orderBy("source", "ASC")
      .getRawMany<{ source: string }>();

    const coreLabels: Record<string, string> = {
      [CORE_PRODUCT_SOURCES.CUSTOM]: "Custom",
      [CORE_PRODUCT_SOURCES.MANUAL]: "Manual",
    };

    const sources = await Promise.all(
      rows.map(async ({ source }) => {
        if (coreLabels[source]) return { value: source, label: coreLabels[source] };
        const plugin = await pluginRegistryRepository.findByPluginId(source);
        return { value: source, label: plugin?.name ?? source };
      }),
    );

    return { sources };
  }),
});
