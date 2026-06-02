<template>
  <div class="product-recommendation">
    <div v-if="query" class="product-recommendation__hint">
      <ShoppingBag class="h-3 w-3 inline mr-1" />
      <span>{{ query }}</span>
    </div>
    <div class="product-recommendation__grid">
      <a
        v-for="p in products"
        :key="p.id"
        :href="p.sourceUrl || '#'"
        target="_blank"
        rel="noopener noreferrer"
        class="product-recommendation__card"
      >
        <div class="product-recommendation__image-wrap">
          <img
            v-if="p.imageUrl"
            :src="p.imageUrl"
            :alt="p.title"
            class="product-recommendation__image"
            loading="lazy"
          />
          <div v-else class="product-recommendation__image-fallback">
            <Package class="h-8 w-8 opacity-30" />
          </div>
          <span v-if="!p.available" class="product-recommendation__badge">Out of stock</span>
        </div>
        <div class="product-recommendation__body">
          <div class="product-recommendation__title">{{ p.title }}</div>
          <div v-if="p.vendor" class="product-recommendation__vendor">{{ p.vendor }}</div>
          <div v-if="p.topVariant?.price" class="product-recommendation__price">
            <span class="product-recommendation__price-current">
              {{ formatPrice(p.topVariant.price, p.topVariant.currency) }}
            </span>
            <span v-if="p.topVariant.compareAtPrice" class="product-recommendation__price-compare">
              {{ formatPrice(p.topVariant.compareAtPrice, p.topVariant.currency) }}
            </span>
          </div>
        </div>
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Package, ShoppingBag } from "lucide-vue-next";
import type { ProductRecommendationCardProduct } from "@/types/message";

interface Props {
  products: ProductRecommendationCardProduct[];
  query?: string;
}

defineProps<Props>();

function formatPrice(amount?: string | number, currency?: string): string {
  if (amount === undefined || amount === null || amount === "") return "";
  const value = typeof amount === "string" ? parseFloat(amount) : amount;
  if (Number.isNaN(value)) return "";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency ?? ""}`.trim();
  }
}
</script>

<style scoped>
.product-recommendation {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.product-recommendation__hint {
  font-size: 0.75rem;
  opacity: 0.7;
}

.product-recommendation__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.5rem;
}

.product-recommendation__card {
  display: flex;
  flex-direction: column;
  border-radius: 0.5rem;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.1));
  background: var(--background, white);
  text-decoration: none;
  color: inherit;
  overflow: hidden;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.product-recommendation__card:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.product-recommendation__image-wrap {
  position: relative;
  aspect-ratio: 1 / 1;
  background: var(--muted, #f3f4f6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.product-recommendation__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.product-recommendation__image-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.product-recommendation__badge {
  position: absolute;
  bottom: 0.25rem;
  left: 0.25rem;
  background: rgba(0, 0, 0, 0.65);
  color: white;
  font-size: 0.65rem;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
}

.product-recommendation__body {
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.product-recommendation__title {
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.2;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.product-recommendation__vendor {
  font-size: 0.7rem;
  opacity: 0.65;
}

.product-recommendation__price {
  display: flex;
  gap: 0.375rem;
  align-items: baseline;
  margin-top: 0.25rem;
}

.product-recommendation__price-current {
  font-weight: 600;
}

.product-recommendation__price-compare {
  font-size: 0.75rem;
  text-decoration: line-through;
  opacity: 0.6;
}
</style>
