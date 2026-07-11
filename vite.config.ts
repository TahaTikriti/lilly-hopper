import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // relative base so the build works locally, on GitHub Pages, or any subpath
  base: "./",
  plugins: [tailwindcss()],
});
