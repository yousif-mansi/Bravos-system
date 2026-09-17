import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const apiProxy = {
  "/api": {
    target: process.env.BRAVOS_API_ORIGIN ?? "http://127.0.0.1:3010",
    changeOrigin: false,
  },
};

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      includeAssets: [],
      manifest: {
        name: "برافوس",
        short_name: "برافوس",
        start_url: "/workspace",
        display: "standalone",
        lang: "ar",
        dir: "rtl",
        background_color: "#f3f5f8",
        theme_color: "#1d4ed8",
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,ico,woff2,webmanifest}"],
        globIgnores: ["**/staff-management-*.js", "**/catalog-maintenance-*.js", "**/receiving-stock-*.js", "**/expenses-online-*.js", "**/offer-management-*.js", "**/physical-returns-*.js", "**/recording-corrections-*.js", "**/storefront-settings-*.js", "**/online-order-operations-*.js", "**/opening-import-*.js", "**/management-reports-*.js", "**/storefront-analytics-*.js", "**/manager-backup-*.js", "**/manager-restore-*.js"],
      },
      workbox: {
        skipWaiting: false,
        clientsClaim: true,
      },
      devOptions: { enabled: false },
    }),
  ],
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
            if (/ExpensesPage\.[cm]?[jt]sx?$/.test(chunk.facadeModuleId)) {
              return "assets/expenses-online-[hash].js";
            }
            if (/OffersPage\.[cm]?[jt]sx?$/.test(chunk.facadeModuleId)) {
              return "assets/offer-management-[hash].js";
            }
            if (/ReturnsPage\.[cm]?[jt]sx?$/.test(chunk.facadeModuleId)) {
              return "assets/physical-returns-[hash].js";
            }
            if (/CorrectionsPage\.[cm]?[jt]sx?$/.test(chunk.facadeModuleId)) {
              return "assets/recording-corrections-[hash].js";
            }
            if (/StorefrontSettingsPage\.[cm]?[jt]sx?$/.test(chunk.facadeModuleId)) {
              return "assets/storefront-settings-[hash].js";
            }
            if (/OnlineOrdersPage\.[cm]?[jt]sx?$/.test(chunk.facadeModuleId)) {
              return "assets/online-order-operations-[hash].js";
            }
            if (/OpeningImportPage\.[cm]?[jt]sx?$/.test(chunk.facadeModuleId)) {
              return "assets/opening-import-[hash].js";
            }
            if (/ReportsPage\.[cm]?[jt]sx?$/.test(chunk.facadeModuleId)) {
              return "assets/management-reports-[hash].js";
            }
            if (/AnalyticsPage\.[cm]?[jt]sx?$/.test(chunk.facadeModuleId)) {
              return "assets/storefront-analytics-[hash].js";
            }
            if (/BackupPage\.[cm]?[jt]sx?$/.test(chunk.facadeModuleId)) {
              return "assets/manager-backup-[hash].js";
            }
            if (/RestorePage\.[cm]?[jt]sx?$/.test(chunk.facadeModuleId)) {
              return "assets/manager-restore-[hash].js";
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
