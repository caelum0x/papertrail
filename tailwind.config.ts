import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111318",
        paper: "#FAFAF8",
        accent: "#C4522A",
      },
    },
  },
  plugins: [],
};
export default config;
