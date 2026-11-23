import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Storage } from "./storage";
import type { Entry, Settings } from "./types";

export class TauriStorage implements Storage {
  kind = "mac" as const;
  getSettings() {
    return invoke<Settings>("get_settings");
  }
  saveSettings(settings: Settings) {
    return invoke<void>("save_settings", { settings });
  }
  openRoot(root: string) {
    return invoke<void>("open_root", { root });
  }
  scan() {
    return invoke<Entry[]>("scan_tree");
  }
  readMany(paths: string[]) {
    return invoke<(string | null)[]>("read_many", { paths });
  }
  read(path: string) {
    return invoke<string | null>("read_text", { path });
  }
  write(path: string, content: string) {
    return invoke<void>("write_text", { path, content });
  }
  move(from: string, to: string) {
    return invoke<void>("move_within", { from, to });
  }
  renameDir(from: string, to: string) {
    return invoke<void>("rename_dir", { from, to });
  }
  exists(path: string) {
    return invoke<boolean>("path_exists", { path });
  }
  mkdir(path: string) {
    return invoke<void>("make_dir", { path });
  }
  removeEmptyDir(path: string) {
    return invoke<boolean>("remove_empty_dir", { path });
  }
  async readBytes(path: string) {
    try {
      return new Uint8Array(await invoke<ArrayBuffer>("read_bytes", { path }));
    } catch {
      return null;
    }
  }
  writeBytes(path: string, data: Uint8Array) {
    return invoke<void>("write_bytes", data, { headers: { "x-path": encodeURIComponent(path) } });
  }
  importFile(fromAbs: string, to: string) {
    return invoke<void>("import_file", { fromAbs, to });
  }
  async fileUrl(path: string) {
    const abs = await invoke<string>("full_path", { path });
    return convertFileSrc(abs);
  }
  open(path: string) {
    return invoke<void>("open_in_os", { path });
  }
  openUrl(url: string) {
    return invoke<void>("open_url", { url });
  }
  reveal(path: string) {
    return invoke<void>("reveal_in_finder", { path });
  }
  async pickFolder() {
    const r = await openDialog({ directory: true, multiple: false, title: "Choose your LifeOS folder" });
    return typeof r === "string" ? r : null;
  }
  async pickFiles(only?: { name: string; extensions: string[] }) {
    const r = await openDialog({
      multiple: true,
      directory: false,
      title: "Add files (they'll be moved into LifeOS)",
      ...(only ? { filters: [only] } : {}),
    });
    if (!r) return [];
    return Array.isArray(r) ? r : [r];
  }
  onChange(cb: () => void) {
    let un: (() => void) | undefined;
    let cancelled = false;
    listen("lifeos-changed", () => cb()).then((u) => {
      if (cancelled) u();
      else un = u;
    });
    return () => {
      cancelled = true;
      un?.();
    };
  }
}
