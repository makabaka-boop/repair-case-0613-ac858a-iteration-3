import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 本地开发：/api 代理到 FastAPI（联调真实接口，不使用 mock）。
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
