import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and doesn't want Vite to clear the terminal.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: "safari15", outDir: "dist" },
  test: { environment: "node" },
} as any);
