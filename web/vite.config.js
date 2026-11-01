import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the API runs on PORT (default 6800, npm run dev -w server) and Vite on VITE_PORT (default 6801); /api is proxied, so the browser only ever
// talks to one origin (same-origin writes). Both stay inside 6800-6849.
const api = { target: `http://127.0.0.1:${Number(process.env.PORT) || 6800}` };

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: Number(process.env.VITE_PORT) || 6801, strictPort: true, proxy: { "/api": api } },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js", testTimeout: 30000 },
});
