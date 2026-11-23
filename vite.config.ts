import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

// A short stamp (which version of the code this app was built from) shown in Settings.
function buildStamp(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return `${sha} · built ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  } catch {
    return `built ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  }
}

// Tauri expects a fixed port and doesn't want Vite to clear the terminal.
export default defineConfig({
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(buildStamp()) },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  // es2020 so older Macs (Safari 16 on macOS Big Sur) can read the code.
  build: { target: "es2020", outDir: "dist" },
  test: { environment: "node" },
} as any);
