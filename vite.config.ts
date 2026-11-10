import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and doesn't want Vite to clear the terminal.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  // es2020 so older Macs (Safari 16 on macOS Big Sur) can read the code.
  build: { target: "es2020", outDir: "dist" },
  test: { environment: "node" },
} as any);
