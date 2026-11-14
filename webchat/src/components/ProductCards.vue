<template>
  <div class="hay-product-recs">
    <div v-for="p in products" :key="p.id" class="hay-product-card">
      <a
        :href="safeHttpUrl(p.sourceUrl) ?? '#'"
        target="_blank"
        rel="noopener noreferrer"
        class="hay-product-card__link"
        @click="$emit('productClick', p.id, 'card_click')"
      >
        <div class="hay-product-card__image">
          <img v-if="p.imageUrl" :src="p.imageUrl" :alt="p.title" loading="lazy" />
        </div>
        <div class="hay-product-card__body">
          <div class="hay-product-card__title">{{ p.title }}</div>
          <div v-if="p.topVariant?.price" class="hay-product-card__price">
            {{ formatPrice(p.topVariant.price, p.topVariant.currency) }}
            <s v-if="isDiscounted(p)" class="hay-product-card__compare">
              {{ formatPrice(p.topVariant.compareAtPrice, p.topVariant.currency) }}
            </s>
          </div>
          <div
            v-for="option in shownOptions(p)"
            :key="option.name"
            class="hay-product-card__option"
          >
            {{ option.name }}: {{ option.values.join(", ") }}
          </div>
          <div v-if="p.available === false" class="hay-product-card__oos">
            {{ t("product.outOfStock") }}
          </div>
        </div>
      </a>
      <template v-if="cartOf(p) && cartState[p.id] !== 'failed'">
        <a
          v-if="cartState[p.id] === 'added'"
          :href="storePath(cartOf(p)!, cartOf(p)!.props.checkoutPath)"
          class="hay-product-card__buy"
        >
          {{ t("product.checkout") }}
        </a>
        <button
          v-else
          type="button"
          class="hay-product-card__buy"
          :disabled="cartState[p.id] === 'adding'"
          @click="add(p)"
        >
          {{ t("product.addToCart") }}
        </button>
        <div v-if="cartState[p.id] === 'added'" class="hay-product-card__added" role="status">
          {{ t("product.addedToCart") }}
        </div>
      </template>
      <!-- No in-page cart (or the store refused): the plain buy link, when there is one. -->
      <a
        v-else-if="safeHttpUrl(p.topVariant?.buyUrl)"
        :href="safeHttpUrl(p.topVariant?.buyUrl)"
        target="_blank"
        rel="noopener noreferrer"
        class="hay-product-card__buy"
        @click="$emit('productClick', p.id, 'buy_click')"
      >
        {{ t("product.buy") }}
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject, reactive } from "vue";
import { safeHttpUrl } from "@/utils/markdown";
import { addToCart, cartFor, storePath } from "@/utils/cart";
import { cartContextKey } from "@/utils/cartContext";
import { useI18n } from "@/i18n";
import type { ProductClickType, RecommendedProduct } from "@/types";

defineProps<{ products: RecommendedProduct[] }>();
const emit = defineEmits<{ productClick: [productId: string, type: ProductClickType] }>();

const t = useI18n();

// Add to cart in the page, where the store's plugin described its cart (cart@1).
const cartContext = inject(cartContextKey, null);
const cartState = reactive<Record<string, "adding" | "added" | "failed">>({});

const cartOf = (product: RecommendedProduct) =>
  cartContext ? cartFor(cartContext.contributions, product) : null;

const add = async (product: RecommendedProduct) => {
  const cart = cartOf(product);
  const cartItemId = product.topVariant?.cartItemId;
  if (!cart || !cartItemId) return;
  cartState[product.id] = "adding";
  try {
    await addToCart(cart, { cartItemId, conversationId: cartContext?.conversationId.value });
    cartState[product.id] = "added";
    emit("productClick", product.id, "cart_add");
  } catch (error) {
    // The card falls back to its buy link, which the shopper can still follow.
    console.warn("[Hay Webchat] Could not add to cart:", error);
    cartState[product.id] = "failed";
  }
};

/** Options listed on a card; the rest are on the product page. */
const MAX_OPTIONS = 2;

const shownOptions = (product: RecommendedProduct) =>
  (product.options ?? []).filter((o) => Array.isArray(o.values)).slice(0, MAX_OPTIONS);

const isDiscounted = (product: RecommendedProduct): boolean => {
  const price = parseFloat(String(product.topVariant?.price ?? ""));
  const compareAt = parseFloat(String(product.topVariant?.compareAtPrice ?? ""));
  return Number.isFinite(price) && Number.isFinite(compareAt) && compareAt > price;
};

const formatPrice = (amount?: string | number, currency?: string): string => {
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
};
</script>

<style>
.hay-product-recs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
  min-width: 248px;
}

.hay-product-card {
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  border: 1px solid var(--hay-line);
  background: var(--hay-surface);
  overflow: hidden;
}

.hay-product-card:hover {
  border-color: var(--hay-accent);
}

.hay-product-card__link {
  display: flex;
  flex-direction: column;
  flex: 1;
  text-decoration: none;
  color: inherit;
}

.hay-product-card__image {
  aspect-ratio: 1 / 1;
  background: var(--hay-raised);
  display: flex;
  align-items: center;
  justify-content: center;
}

.hay-product-card__image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 0;
}

.hay-product-card__body {
  padding: 6px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hay-product-card__title {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.hay-product-card__price {
  font-size: 12px;
  font-weight: 600;
  color: var(--hay-accent);
}

.hay-product-card__compare {
  margin-left: 4px;
  font-weight: 400;
  color: var(--hay-meta);
}

.hay-product-card__option {
  font-size: 10px;
  line-height: 1.3;
  color: var(--hay-meta);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hay-product-card__oos {
  font-size: 10px;
  color: var(--hay-meta);
}

.hay-product-card__buy {
  margin: 0 8px 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--hay-brand);
  color: var(--hay-on-brand);
  font-size: 12px;
  font-weight: 600;
  text-align: center;
  text-decoration: none;
}

button.hay-product-card__buy {
  border: 0;
  font-family: inherit;
  cursor: pointer;
}

.hay-product-card__buy:disabled {
  opacity: 0.6;
  cursor: progress;
}

.hay-product-card__added {
  margin: -4px 8px 8px;
  font-size: 10px;
  text-align: center;
  color: var(--hay-meta);
}

.hay-product-card__buy:hover {
  filter: brightness(0.95);
}

.hay-product-card__buy:focus-visible,
.hay-product-card__link:focus-visible {
  outline: 2px solid var(--hay-accent);
  outline-offset: 2px;
}
</style>
