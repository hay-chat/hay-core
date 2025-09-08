import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

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
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--red))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
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
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        primary: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        secondary: ["europa", "sans-serif"],
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
