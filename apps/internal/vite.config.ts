import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiProxy = {
  "/api": {
    target: process.env.BRAVOS_API_ORIGIN ?? "http://127.0.0.1:3010",
    changeOrigin: false,
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  build: {
    rollupOptions: {
      output: {
        chunkFileNames(chunk) {
          if (typeof chunk.facadeModuleId === "string") {
            if (/StaffPage\.[cm]?[jt]sx?$/.test(chunk.facadeModuleId)) {
              return "assets/staff-management-[hash].js";
            }
            if (/CatalogPage\.[cm]?[jt]sx?$/.test(chunk.facadeModuleId)) {
              return "assets/catalog-maintenance-[hash].js";
            }
            if (/LookupPage\.[cm]?[jt]sx?$/.test(chunk.facadeModuleId)) {
              return "assets/cashier-lookup-[hash].js";
            }
            if (/ReceivingPage\.[cm]?[jt]sx?$/.test(chunk.facadeModuleId)) {
              return "assets/receiving-stock-[hash].js";
            }
            if (/SalesPage\.[cm]?[jt]sx?$/.test(chunk.facadeModuleId)) {
              return "assets/cashier-sales-[hash].js";
            }
          }
          return "assets/[name]-[hash].js";
        },
        manualChunks(id) {
          const normalized = id.split(path.sep).join("/");
          if (normalized.includes("/node_modules/react-dom/") || normalized.includes("/node_modules/react/")) {
            return "react";
          }
          if (normalized.includes("/node_modules/react-router")) {
            return "router";
          }
          return undefined;
        },
      },
    },
  },
});
