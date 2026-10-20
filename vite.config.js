import { defineConfig } from "vite";

export default defineConfig({
  base: "./",

  optimizeDeps: {
    exclude: ["mecab-web-worker"]
  },

  worker: {
    format: "es"
  },

  build: {
    target: "es2022"
  }
});