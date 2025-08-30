export class VectorType {
  sqlType: string;
  
  constructor(private dimensions?: number) {
    this.sqlType = this.dimensions ? `vector(${this.dimensions})` : "vector";
  }
}

export const VectorColumnType = (dimensions?: number) => ({
  type: "simple-array",
  transformer: {
    to: (value: number[] | null): string | null => {
      if (!value || !Array.isArray(value)) return null;
      return `[${value.join(",")}]`;
    },
    from: (value: string | null): number[] | null => {
      if (!value) return null;
      if (Array.isArray(value)) return value;

      const cleaned = value.replace(/[\[\]]/g, "");
      if (!cleaned) return null;

      return cleaned.split(",").map((v) => parseFloat(v.trim()));
    },
  },
});
