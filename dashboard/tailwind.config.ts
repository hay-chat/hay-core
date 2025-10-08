// tailwind.config.ts
import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";
import plugin from "tailwindcss/plugin";

export default <Partial<Config>>{
  darkMode: "class",
  content: [
    "./components/**/*.{js,vue,ts}",
    "./layouts/**/*.vue",
    "./pages/**/*.vue",
    "./plugins/**/*.{js,ts}",
    "./nuxt.config.{js,ts}",
    "./app.vue",
  ],
  theme: {
    extend: {
      colors: {
        border: { DEFAULT: "var(--color-neutral-300)" },
        input: { DEFAULT: "var(--color-neutral-300)" },
        ring: { DEFAULT: "var(--color-primary)" },
        background: {
          DEFAULT: "var(--color-neutral-0)",
          secondary: "var(--color-neutral-50)",
          tertiary: "var(--color-neutral-100)",
        },
        foreground: { DEFAULT: "var(--color-neutral)" },
        accent: { DEFAULT: "var(--color-neutral-100)" },
        muted: { DEFAULT: "var(--color-neutral-100)" },
        neutral: {
          "0": "#ffffff",
          "50": " oklch(98.4% .003 247.858)",
          "100": " oklch(96.8% .007 247.896)",
          "200": " oklch(92.9% .013 255.508)",
          "300": " oklch(86.9% .022 252.894)",
          "400": " oklch(70.4% .04 256.788)",
          "500": " oklch(55.4% .046 257.417)",
          "600": " oklch(44.6% .043 257.281)",
          "700": " oklch(37.2% .044 257.287)",
          "800": " oklch(27.9% .041 260.031)",
          "900": " oklch(20.8% .042 265.755)",
          "950": " oklch(12.9% .042 264.695)",
          DEFAULT: "var(--color-neutral-700)",
          muted: "var(--color-neutral-500)",
        },
        primary: {
          "50": "#e8f3ff",
          "100": "#d5e9ff",
          "200": "#b3d5ff",
          "300": "#85b7ff",
          "400": "#568aff",
          "500": "#2f5dff",
          "600": "#0c2bff",
          "700": "#001df5",
          "800": "#0621cd",
          "900": "#10279f",
          "950": "#0a155c",
          DEFAULT: "#001df5",
          foreground: "#ffffff",
        },
        red: {
          "50": "#fdf3f3",
          "100": "#fbe5e5",
          "200": "#f8d0d0",
          "300": "#f2afaf",
          "400": "#e88181",
          "500": "#d74848",
          "600": "#c63c3c",
          "700": "#a62f2f",
          "800": "#8a2a2a",
          "900": "#732929",
          "950": "#3e1111",
          DEFAULT: "var(--color-red-600)",
        },
        destructive: {
          "50": "#fdf3f3",
          "100": "#fbe5e5",
          "200": "#f8d0d0",
          "300": "#f2afaf",
          "400": "#e88181",
          "500": "#d74848",
          "600": "#c63c3c",
          "700": "#a62f2f",
          "800": "#8a2a2a",
          "900": "#732929",
          "950": "#3e1111",
          foreground: "#ffffff",
          DEFAULT: "var(--color-destructive-600)",
        },
        green: {
          "50": "#f9fce9",
          "100": "#f1f8cf",
          "200": "#e2f1a5",
          "300": "#cee571",
          "400": "#beda58",
          "500": "#99bb27",
          "600": "#77951b",
          "700": "#5b7219",
          "800": "#495b19",
          "900": "#3e4d1a",
          "950": "#1f2a09",
          DEFAULT: "var(--color-green-600)",
        },
        purple: {
          "50": "#faf5ff",
          "100": "#f4e8ff",
          "200": "#ebd5ff",
          "300": "#dbb4fe",
          "400": "#c384fc",
          "500": "#aa55f7",
          "600": "#9333ea",
          "700": "#7c22ce",
          "800": "#6821a8",
          "900": "#541c87",
          "950": "#380764",
          DEFAULT: "var(--color-purple-600)",
        },

        action: {
          "50": "rgb(250, 247, 254)",
          "100": "rgb(246, 237, 253)",
          "200": "rgb(236, 219, 251)",
          "300": "rgb(222, 194, 249)",
          "400": "rgb(202, 155, 245)",
          "500": "rgb(180, 115, 241)",
          "600": "rgb(158, 73, 236)",
          "700": "rgb(131, 24, 230)",
          "800": "rgb(105, 19, 185)",
          "900": "rgb(87, 16, 154)",
          "950": "rgb(51, 9, 90)",
          DEFAULT: "var(--color-action-600)",
        },
        teal: {
          "50": "rgb(242, 250, 247)",
          "100": "rgb(224, 245, 237)",
          "200": "rgb(194, 234, 220)",
          "300": "rgb(149, 219, 195)",
          "400": "rgb(74, 195, 152)",
          "500": "rgb(54, 163, 125)",
          "600": "rgb(44, 132, 102)",
          "700": "rgb(35, 106, 81)",
          "800": "rgb(28, 84, 65)",
          "900": "rgb(23, 69, 53)",
          "950": "rgb(13, 39, 30)",
          DEFAULT: "var(--color-teal-600)",
        },
        document: {
          "50": "rgb(255, 247, 237)",
          "100": "rgb(254, 238, 219)",
          "200": "rgb(253, 220, 183)",
          "300": "rgb(252, 195, 129)",
          "400": "rgb(249, 151, 40)",
          "500": "rgb(219, 120, 6)",
          "600": "rgb(178, 97, 5)",
          "700": "rgb(142, 78, 4)",
          "800": "rgb(113, 62, 3)",
          "900": "rgb(93, 51, 3)",
          "950": "rgb(53, 29, 1)",
          DEFAULT: "var(--color-document-600)",
        },
      },
      borderRadius: {
        lg: "0.5rem",
        md: "0.4rem",
        sm: "0.3rem",
        DEFAULT: "var(--border-radius-md)",
      },
      fontFamily: {
        primary: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        secondary: ["Gabarito", "sans-serif"],
      },
    },
  },
  plugins: [
    tailwindcssAnimate,
    plugin(({ addBase, theme }) => {
      const cssVars: Record<string, string> = {};

      // Function to generate CSS variables for any theme property
      const generateCssVars = (
        themeKey: string,
        themeValue: Record<string, string | string[] | Record<string, string>>,
      ) => {
        Object.entries(themeValue).forEach(([key, value]) => {
          if (typeof value === "string") {
            const varName = key === "DEFAULT" ? `--${themeKey}` : `--${themeKey}-${key}`;
            cssVars[varName] = value;
          } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            Object.entries(value).forEach(([shade, shadeValue]) => {
              if (typeof shadeValue === "string") {
                const varName =
                  shade === "DEFAULT" ? `--${themeKey}-${key}` : `--${themeKey}-${key}-${shade}`;
                cssVars[varName] = shadeValue;
              }
            });
          } else if (Array.isArray(value)) {
            // Handle font families which are arrays
            cssVars[`--${themeKey}-${key}`] = value.join(", ");
          }
        });
      };

      // Generate CSS variables for colors
      const colors = theme("colors") as Record<string, string | Record<string, string>>;
      generateCssVars("color", colors);

      // Generate CSS variables for other theme properties
      const borderRadius = theme("borderRadius") as Record<string, string>;
      generateCssVars("border-radius", borderRadius);

      const fontFamily = theme("fontFamily") as Record<string, string[]>;
      generateCssVars("font-family", fontFamily);

      addBase({ ":root": cssVars });
    }),
  ],
};
