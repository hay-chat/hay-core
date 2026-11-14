/**
 * Matching a shopper's chosen options ("size M", "colour blue") against a
 * product's variants.
 *
 * Stores name the same option differently (Size / Tamanho / Talla), so option
 * names are compared through a small table of equivalents; any other name has
 * to match the store's own option name. Values are never translated or guessed.
 */

import { VariantAvailability, type VariantSelectedOption } from "@server/entities/product.enums";

export interface OptionFilter {
  name: string;
  value: string;
}

/** The parts of a variant the matching reads. */
export interface OptionVariant {
  selectedOptions?: VariantSelectedOption[] | null;
  availability: VariantAvailability;
  price?: string;
}

export interface VariantChoice<V> {
  /** The variant to show: its price and stock are the ones the shopper will get. */
  topVariant?: V;
  /** True only when exactly one variant fits and it is in stock. */
  canBuyDirectly: boolean;
  /** How many variants fit the shopper's options; unset when none were given. */
  matchingVariantCount?: number;
}

/** Option names that mean the same thing, already normalised (see `normalise`). */
const EQUIVALENT_OPTION_NAMES: string[][] = [
  ["size", "sizes", "tamanho", "talla", "talle", "taille", "grosse", "groesse", "taglia", "maat"],
  ["color", "colour", "colors", "colours", "cor", "couleur", "farbe", "colore", "kleur"],
];

/** Lower case, no accents, so "Größe" and "grosse", "Côr" and "cor" compare equal. */
function normalise(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/ß/g, "ss").trim();
}

function optionNameKey(name: string): string {
  const normalised = normalise(name);
  // "Shoe size" and "Tamanho do calçado" are still a size.
  const words = normalised.split(/[^\p{L}\p{N}]+/u);
  const group = EQUIVALENT_OPTION_NAMES.find((names) => words.some((w) => names.includes(w)));
  return group ? group[0] : normalised;
}

/** Words of an option value: "Navy Blue" and "M/L" have two, "42.5" has one. */
function valueWords(value: string): string[] {
  return normalise(value)
    .split(/[\s/|()]+/)
    .filter(Boolean);
}

const NO_MATCH = 0;
const PARTIAL_MATCH = 1;
const EXACT_MATCH = 2;

/** Exact when the value is the same, partial when it holds every wanted word ("blue" in "Navy Blue"). */
function valueMatch(actual: string, wanted: string): number {
  if (normalise(actual) === normalise(wanted)) return EXACT_MATCH;
  const actualWords = valueWords(actual);
  const wantedWords = valueWords(wanted);
  if (!wantedWords.length) return NO_MATCH;
  return wantedWords.every((word) => actualWords.includes(word)) ? PARTIAL_MATCH : NO_MATCH;
}

/** How well a variant fits every filter: the weakest filter decides. */
function variantMatch(variant: OptionVariant, filters: OptionFilter[]): number {
  let weakest = EXACT_MATCH;
  for (const filter of filters) {
    const nameKey = optionNameKey(filter.name);
    const best = Math.max(
      NO_MATCH,
      ...(variant.selectedOptions ?? [])
        .filter((option) => optionNameKey(option.name) === nameKey)
        .map((option) => valueMatch(option.value, filter.value)),
    );
    if (best === NO_MATCH) return NO_MATCH;
    weakest = Math.min(weakest, best);
  }
  return weakest;
}

/**
 * The variants that fit all the filters. When some fit exactly, the looser
 * matches are dropped: "blue" picks "Blue" over "Navy Blue" when both exist.
 */
export function matchVariants<V extends OptionVariant>(
  variants: V[],
  filters: OptionFilter[],
): V[] {
  const scored = variants
    .map((variant) => ({ variant, match: variantMatch(variant, filters) }))
    .filter(({ match }) => match !== NO_MATCH);
  const best = Math.max(NO_MATCH, ...scored.map(({ match }) => match));
  return scored.filter(({ match }) => match === best).map(({ variant }) => variant);
}

const isInStock = (variant: OptionVariant) => variant.availability === VariantAvailability.IN_STOCK;

/** Cheapest in-stock variant, or the cheapest of all when none is in stock. */
function cheapest<V extends OptionVariant>(variants: V[]): V | undefined {
  const inStock = variants.filter(isInStock);
  const pool = inStock.length ? inStock : variants;
  const price = (variant: V) =>
    variant.price !== undefined ? parseFloat(variant.price) : Number.POSITIVE_INFINITY;
  return [...pool].sort((a, b) => price(a) - price(b))[0];
}

/**
 * Pick the variant a recommendation shows, or null when the product does not
 * fit what the shopper chose.
 *
 * Stock is checked on the variants that fit, not on the product: a shirt with
 * only XL left is not "in stock" for someone who asked for M. A variant can be
 * bought directly only when it is the single one that fits, so we never choose
 * a size or colour the shopper did not.
 */
export function chooseVariant<V extends OptionVariant>(
  variants: V[],
  filters: OptionFilter[],
  inStockOnly: boolean,
): VariantChoice<V> | null {
  if (!filters.length) {
    const topVariant = cheapest(variants);
    return {
      topVariant,
      canBuyDirectly: variants.length === 1 && !!topVariant && isInStock(topVariant),
    };
  }

  const matching = matchVariants(variants, filters);
  if (!matching.length) return null;
  if (inStockOnly && !matching.some(isInStock)) return null;

  const topVariant = cheapest(matching);
  return {
    topVariant,
    canBuyDirectly: matching.length === 1 && !!topVariant && isInStock(topVariant),
    matchingVariantCount: matching.length,
  };
}
