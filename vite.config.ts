import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: path.resolve(__dirname, "standalone"),
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  build: {
    outDir: path.resolve(__dirname, "dist-html"),
    emptyOutDir: true,
  },
});
