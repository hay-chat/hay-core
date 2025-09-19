import type {
  TooltipItem,
  TooltipOptions,
  LegendOptions,
  CartesianScaleOptions,
  ChartType
} from "chart.js";

// Chart color palette based on your design system
export const CHART_COLORS = {
  primary: ["#001df5", "#0c2bff", "#2f5dff", "#568aff", "#85b7ff", "#b3d5ff"],
  secondary: ["#9333ea", "#aa55f7", "#c384fc", "#dbb4fe", "#ebd5ff", "#f4e8ff"],
  success: ["#77951b", "#99bb27", "#beda58", "#cee571", "#e2f1a5", "#f1f8cf"],
  danger: ["#c63c3c", "#d74848", "#e88181", "#f2afaf", "#f8d0d0", "#fbe5e5"],
  warning: ["#db7806", "#f59e0b", "#fbbf24", "#fcd34d", "#fde68a", "#fef3c7"],
  teal: ["#2c8466", "#36a37d", "#4ac398", "#5dd9ae", "#a9f4d7", "#d4f9ec"],
  purple: ["#7c22ce", "#9333ea", "#aa55f7", "#c384fc", "#dbb4fe", "#f4e8ff"],
  action: ["#8313e6", "#9e49ec", "#b473f1", "#ce9df5", "#e2c7fa", "#f6edfd"],
  document: ["#b26105", "#db7806", "#f99728", "#fcb951", "#fdd383", "#fee8bb"],
  neutral: ["#374257", "#4a5568", "#64748b", "#94a3b8", "#cbd5e1", "#e2e8f0"],
} as const;

// Default palette for multi-dataset charts
export const DEFAULT_CHART_PALETTE = [
  ...CHART_COLORS.primary.slice(0, 3),
  ...CHART_COLORS.secondary.slice(0, 3),
  ...CHART_COLORS.teal.slice(0, 2),
  ...CHART_COLORS.warning.slice(0, 2),
];

// Sentiment-based colors (positive, neutral, negative)
export const SENTIMENT_COLORS = {
  positive: CHART_COLORS.success[1], // #99bb27
  neutral: CHART_COLORS.warning[1], // #f59e0b
  negative: CHART_COLORS.danger[1], // #d74848
};

// Status-based colors
export const STATUS_COLORS = {
  active: CHART_COLORS.primary[2], // #2f5dff
  completed: CHART_COLORS.success[1], // #99bb27
  pending: CHART_COLORS.warning[1], // #f59e0b
  failed: CHART_COLORS.danger[1], // #d74848
  cancelled: CHART_COLORS.neutral[3], // #94a3b8
};

// Tooltip configuration with custom styling
export const getTooltipConfig = (options?: {
  showPercentage?: boolean;
  formatValue?: (value: number) => string;
}): any => ({
  enabled: true,
  mode: "index" as const,
  intersect: false,
  backgroundColor: "rgba(15, 23, 42, 0.95)", // Dark background with opacity
  titleColor: "#ffffff",
  bodyColor: "#e2e8f0",
  titleFont: {
    family: "Inter, ui-sans-serif, system-ui, sans-serif",
    size: 13,
    weight: 600,
  },
  bodyFont: {
    family: "Inter, ui-sans-serif, system-ui, sans-serif",
    size: 12,
    weight: 400,
  },
  padding: {
    top: 8,
    right: 12,
    bottom: 8,
    left: 12,
  },
  borderColor: "rgba(148, 163, 184, 0.2)",
  borderWidth: 1,
  cornerRadius: 6,
  displayColors: true,
  boxPadding: 4,
  callbacks: {
    label: (context: TooltipItem<ChartType>) => {
      const label = context.dataset.label || "";
      const value = context.parsed.y ?? context.parsed.x ?? context.parsed;

      // Format value if formatter provided
      const formattedValue = options?.formatValue
        ? options.formatValue(value as number)
        : value.toLocaleString();

      // Add percentage if requested
      if (options?.showPercentage && context.dataset.data) {
        const numericData = context.dataset.data.map(d => {
          if (typeof d === 'number') return d;
          if (d === null) return 0;
          if (typeof d === 'object' && 'y' in d) return (d as any).y;
          return 0;
        });
        const total = numericData.reduce((a, b) => a + b, 0);
        if (total > 0 && typeof value === 'number') {
          const percentage = ((value / total) * 100).toFixed(1);
          return `${label}: ${formattedValue} (${percentage}%)`;
        }
      }

      return label ? `${label}: ${formattedValue}` : formattedValue;
    },
  } as TooltipOptions["callbacks"],
});

// Grid and scale configuration
export const getScaleConfig = (options?: {
  hideXGrid?: boolean;
  hideYGrid?: boolean;
  beginAtZero?: boolean;
}): any => ({
  x: {
    grid: {
      display: !options?.hideXGrid,
      color: "rgba(148, 163, 184, 0.08)",
      lineWidth: 1,
    },
    ticks: {
      color: "#64748b",
      font: {
        family: "Inter, ui-sans-serif, system-ui, sans-serif",
        size: 11,
      },
    } as CartesianScaleOptions["ticks"],
    border: {
      display: false,
    } as CartesianScaleOptions["border"],
  },
  y: {
    grid: {
      display: !options?.hideYGrid,
      color: "rgba(148, 163, 184, 0.08)",
      lineWidth: 1,
    },
    ticks: {
      color: "#64748b",
      font: {
        family: "Inter, ui-sans-serif, system-ui, sans-serif",
        size: 11,
      },
    } as CartesianScaleOptions["ticks"],
    border: {
      display: false,
    } as CartesianScaleOptions["border"],
    ...(options?.beginAtZero !== undefined && { beginAtZero: options.beginAtZero }),
  },
});

// Legend configuration
export const getLegendConfig = (show = false): any => ({
  display: show,
  position: "top",
  align: "start",
  labels: {
    color: "#374257",
    font: {
      family: "Inter, ui-sans-serif, system-ui, sans-serif",
      size: 12,
      weight: 500,
    },
    padding: 15,
    usePointStyle: true,
    pointStyle: "circle",
  },
});

// Get color by index from default palette
export const getChartColor = (index: number): string => {
  return DEFAULT_CHART_PALETTE[index % DEFAULT_CHART_PALETTE.length];
};

// Get color array for a specific theme
export const getThemeColors = (
  theme: keyof typeof CHART_COLORS,
  count: number
): string[] => {
  const colors = CHART_COLORS[theme];
  const result: string[] = [];

  for (let i = 0; i < count; i++) {
    result.push(colors[i % colors.length]);
  }

  return result;
};

// Create a gradient color for charts
export const createGradient = (
  ctx: CanvasRenderingContext2D,
  color: string,
  height: number
): CanvasGradient => {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, color + "40"); // 25% opacity
  gradient.addColorStop(1, color + "05"); // 3% opacity
  return gradient;
};