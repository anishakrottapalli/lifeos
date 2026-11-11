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
  importFile(fromAbs: string, to: string) {
    return invoke<void>("import_file", { fromAbs, to });
  }
  async fileUrl(path: string) {
    const abs = await invoke<string>("full_path", { path });
    return convertFileSrc(abs);
  }
  async readBase64(path: string) {
    const url = await this.fileUrl(path);
    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  open(path: string) {
    return invoke<void>("open_in_os", { path });
  }
  reveal(path: string) {
    return invoke<void>("reveal_in_finder", { path });
  }
  async pickFolder() {
    const r = await openDialog({ directory: true, multiple: false, title: "Choose your LifeOS folder" });
    return typeof r === "string" ? r : null;
  }
  async pickFiles() {
    const r = await openDialog({ multiple: true, directory: false, title: "Add files (they'll be moved into LifeOS)" });
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
