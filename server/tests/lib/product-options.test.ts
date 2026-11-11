import { describe, it, expect } from "@jest/globals";
import { chooseVariant, matchVariants, type OptionVariant } from "@server/lib/product-options";
import { VariantAvailability } from "@server/entities/product.enums";

const { IN_STOCK, OUT_OF_STOCK } = VariantAvailability;

interface TestVariant extends OptionVariant {
  id: string;
}

function variant(
  id: string,
  options: Record<string, string>,
  availability: VariantAvailability = IN_STOCK,
  price = "20.00",
): TestVariant {
  return {
    id,
    availability,
    price,
    selectedOptions: Object.entries(options).map(([name, value]) => ({ name, value })),
  };
}

const ids = (variants: TestVariant[]) => variants.map((v) => v.id);

describe("matchVariants", () => {
  const shirt = [
    variant("s-blue", { Size: "S", Color: "Blue" }),
    variant("m-blue", { Size: "M", Color: "Blue" }),
    variant("m-white", { Size: "M", Color: "White" }),
  ];

  it("matches names and values whatever their case", () => {
    expect(ids(matchVariants(shirt, [{ name: "size", value: "m" }]))).toEqual([
      "m-blue",
      "m-white",
    ]);
    expect(
      ids(
        matchVariants(shirt, [
          { name: "SIZE", value: "M" },
          { name: "Color", value: "BLUE" },
        ]),
      ),
    ).toEqual(["m-blue"]);
  });

  it("treats Size / Tamanho / Talla and Color / Colour / Cor as the same option", () => {
    const camisa = [variant("pt", { Tamanho: "M", Cor: "Azul" })];
    const camiseta = [variant("es", { Talla: "M", Color: "Azul" })];
    const jumper = [variant("uk", { Size: "M", Colour: "Azul" })];
    const wanted = [
      { name: "size", value: "M" },
      { name: "color", value: "azul" },
    ];
    expect(ids(matchVariants(camisa, wanted))).toEqual(["pt"]);
    expect(ids(matchVariants(camiseta, wanted))).toEqual(["es"]);
    expect(ids(matchVariants(jumper, wanted))).toEqual(["uk"]);
    expect(ids(matchVariants(jumper, [{ name: "Tamanho", value: "M" }]))).toEqual(["uk"]);
  });

  it("ignores accents and recognises a size inside a longer option name", () => {
    const shoe = [variant("de", { Größe: "42" }), variant("br", { "Tamanho do calçado": "42" })];
    expect(ids(matchVariants(shoe, [{ name: "size", value: "42" }]))).toEqual(["de", "br"]);
  });

  it("matches any other option only by the store's own name for it", () => {
    const sofa = [variant("oak", { Material: "Oak" }), variant("pine", { Material: "Pine" })];
    expect(ids(matchVariants(sofa, [{ name: "material", value: "oak" }]))).toEqual(["oak"]);
    expect(matchVariants(sofa, [{ name: "finish", value: "oak" }])).toEqual([]);
  });

  it("never matches a value under a different option", () => {
    const tee = [variant("men", { Gender: "M", Color: "Blue" })];
    expect(matchVariants(tee, [{ name: "size", value: "M" }])).toEqual([]);
  });

  it("does not confuse neighbouring sizes", () => {
    const sizes = [
      variant("l", { Size: "L" }),
      variant("xl", { Size: "XL" }),
      variant("42", { Size: "42" }),
      variant("42.5", { Size: "42.5" }),
    ];
    expect(ids(matchVariants(sizes, [{ name: "size", value: "L" }]))).toEqual(["l"]);
    expect(ids(matchVariants(sizes, [{ name: "size", value: "42" }]))).toEqual(["42"]);
  });

  it("accepts a value that is one word of the store's value", () => {
    const navy = [variant("navy", { Color: "Navy Blue" }), variant("red", { Color: "Red" })];
    expect(ids(matchVariants(navy, [{ name: "color", value: "blue" }]))).toEqual(["navy"]);
  });

  it("prefers exact values over looser ones", () => {
    const blues = [variant("navy", { Color: "Navy Blue" }), variant("blue", { Color: "Blue" })];
    expect(ids(matchVariants(blues, [{ name: "color", value: "blue" }]))).toEqual(["blue"]);
  });

  it("matches nothing on a variant without options", () => {
    const plain: TestVariant[] = [{ id: "one", availability: IN_STOCK }];
    expect(matchVariants(plain, [{ name: "size", value: "M" }])).toEqual([]);
  });
});

describe("chooseVariant", () => {
  const sizeM = [{ name: "size", value: "M" }];

  describe("without option filters", () => {
    it("shows the cheapest in-stock variant and never offers to buy a multi-variant product", () => {
      const variants = [
        variant("s", { Size: "S" }, OUT_OF_STOCK, "10.00"),
        variant("m", { Size: "M" }, IN_STOCK, "30.00"),
        variant("l", { Size: "L" }, IN_STOCK, "25.00"),
      ];
      const choice = chooseVariant(variants, [], true);
      expect(choice?.topVariant?.id).toBe("l");
      expect(choice?.canBuyDirectly).toBe(false);
      expect(choice?.matchingVariantCount).toBeUndefined();
    });

    it("offers to buy a single in-stock variant", () => {
      expect(chooseVariant([variant("only", {})], [], true)?.canBuyDirectly).toBe(true);
      expect(chooseVariant([variant("only", {}, OUT_OF_STOCK)], [], false)?.canBuyDirectly).toBe(
        false,
      );
    });

    it("keeps a product that has no variants", () => {
      expect(chooseVariant([], [], true)).toEqual({ topVariant: undefined, canBuyDirectly: false });
    });
  });

  describe("with option filters", () => {
    it("returns the matching variant, not the cheapest, and lets it be bought", () => {
      const variants = [
        variant("s", { Size: "S" }, IN_STOCK, "10.00"),
        variant("m", { Size: "M" }, IN_STOCK, "30.00"),
      ];
      const choice = chooseVariant(variants, sizeM, true);
      expect(choice?.topVariant?.id).toBe("m");
      expect(choice?.canBuyDirectly).toBe(true);
      expect(choice?.matchingVariantCount).toBe(1);
    });

    it("drops a product whose matching variant is sold out, even if other sizes are in stock", () => {
      const variants = [
        variant("m", { Size: "M" }, OUT_OF_STOCK),
        variant("xl", { Size: "XL" }, IN_STOCK),
      ];
      expect(chooseVariant(variants, sizeM, true)).toBeNull();
    });

    it("does not count a backorder variant as in stock", () => {
      const variants = [variant("m", { Size: "M" }, VariantAvailability.BACKORDER)];
      expect(chooseVariant(variants, sizeM, true)).toBeNull();
    });

    it("keeps a sold-out match when stock does not matter, without a buy link", () => {
      const variants = [
        variant("m", { Size: "M" }, OUT_OF_STOCK),
        variant("xl", { Size: "XL" }, IN_STOCK),
      ];
      const choice = chooseVariant(variants, sizeM, false);
      expect(choice?.topVariant?.id).toBe("m");
      expect(choice?.canBuyDirectly).toBe(false);
    });

    it("drops a product with no variant in that option", () => {
      expect(chooseVariant([variant("xl", { Size: "XL" })], sizeM, false)).toBeNull();
      expect(chooseVariant([], sizeM, false)).toBeNull();
    });

    it("does not pick a colour when only the size was chosen", () => {
      const variants = [
        variant("m-blue", { Size: "M", Color: "Blue" }, IN_STOCK, "30.00"),
        variant("m-white", { Size: "M", Color: "White" }, IN_STOCK, "25.00"),
        variant("s-blue", { Size: "S", Color: "Blue" }, IN_STOCK, "5.00"),
      ];
      const choice = chooseVariant(variants, sizeM, true);
      expect(choice?.topVariant?.id).toBe("m-white");
      expect(choice?.canBuyDirectly).toBe(false);
      expect(choice?.matchingVariantCount).toBe(2);
    });

    it("shows the in-stock match but offers no buy link while a sold-out one also fits", () => {
      const variants = [
        variant("m-blue", { Size: "M", Color: "Blue" }, OUT_OF_STOCK, "20.00"),
        variant("m-white", { Size: "M", Color: "White" }, IN_STOCK, "25.00"),
      ];
      const choice = chooseVariant(variants, sizeM, true);
      expect(choice?.topVariant?.id).toBe("m-white");
      expect(choice?.canBuyDirectly).toBe(false);
    });
  });
});
