import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { isLoopbackHost, wardrobeImportApi } from "./scripts/import-job-api.mjs";
import { responsiveImageApi } from "./scripts/responsive-image-api.mjs";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const host = env.WARDROBE_HOST || "127.0.0.1";
  const hasToken = Boolean(env.WARDROBE_TOKEN?.trim());
  if (command === "serve" && !isLoopbackHost(host) && !hasToken) {
    throw new Error(`WARDROBE_HOST=${host} would expose your wardrobe and Anthropic key to your network. Set WARDROBE_TOKEN in .env first.`);
  }
  return {
    optimizeDeps: {
      include: ["react", "react-dom/client"],
    },
    server: {
      host,
      allowedHosts: hasToken ? true : undefined,
      warmup: {
        clientFiles: ["./src/main.jsx"],
      },
    },
    preview: {
      host,
      port: 4173,
      allowedHosts: hasToken ? true : undefined,
    },
    plugins: [react(), responsiveImageApi(), wardrobeImportApi({ env })],
  };
});
