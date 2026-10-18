import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // surfaces
        paper:    "var(--paper)",
        "paper-2":"var(--paper-2)",
        panel:    "var(--panel)",
        "panel-2":"var(--panel-2)",
        // text
        ink:      "var(--ink)",
        muted:    "var(--muted)",
        // borders
        line:     "var(--line)",
        "line-soft": "var(--line-soft)",
        // brand / primary action (orange)
        olive: {
          DEFAULT: "var(--olive)",
          700:     "var(--olive-700)",
          300:     "var(--olive-300)",
          wash:    "var(--olive-wash)",
        },
        brand: {
          DEFAULT: "var(--brand)",
          deep:    "var(--brand-deep)",
          soft:    "var(--brand-soft)",
        },
        // secondary accent
        clay: {
          DEFAULT: "var(--clay)",
          700:     "var(--clay-700)",
          wash:    "var(--clay-wash)",
        },
        // status
        ok:   "var(--ok)",
        warn: "var(--warn)",
        bad:  "var(--bad)",
        // semantic
        kot:  "var(--kot)",
        info: "var(--info)",
      },
      fontFamily: {
        sans:   ["var(--f-sans)", "system-ui", "sans-serif"],
        head:   ["var(--f-sans)", "system-ui", "sans-serif"],
        script: ["var(--f-sans)", "cursive"],
      },
      borderRadius: {
        sm:   "var(--r-sm)",
        md:   "var(--r-md)",
        lg:   "var(--r-lg)",
        xl:   "var(--r-xl)",
        "2xl":"var(--r-2xl)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      maxWidth: { content: "1280px" },
    },
  },
  plugins: [],
};

export default config;
