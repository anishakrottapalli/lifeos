// Older-Mac check. The owner's MacBook runs macOS Big Sur, whose newest Safari
// (16.6) can't parse class methods with private names, like `#e() {}`, in some
// libraries. In dev mode those libraries load untranslated, which leaves a
// blank window. This test fails if any library the screens load uses that
// syntax, so a new dependency can't silently break LifeOS on that Mac.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RUNTIME_PACKAGES = ["react", "react-dom", "scheduler", "yaml", "@tauri-apps/api", "@tauri-apps/plugin-dialog"];
const PRIVATE_METHOD = /(^|[\s;{}])(static\s+|async\s+|get\s+|set\s+|\*\s*)?#[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/m;

function jsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...jsFiles(p));
    else if (/\.(m?js|cjs|ts|tsx)$/.test(name) && !name.endsWith(".d.ts") && !name.endsWith(".map")) out.push(p);
  }
  return out;
}

describe("runs on macOS Big Sur (Safari 16)", () => {
  it("no screen library uses private class methods", () => {
    const offenders: string[] = [];
    for (const pkg of RUNTIME_PACKAGES) {
      for (const f of jsFiles(join("node_modules", pkg))) {
        if (PRIVATE_METHOD.test(readFileSync(f, "utf8"))) offenders.push(f);
      }
    }
    for (const f of jsFiles("src")) {
      if (f.endsWith(".test.ts")) continue;
      if (PRIVATE_METHOD.test(readFileSync(f, "utf8"))) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("the package list above matches what the app depends on", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    for (const dep of Object.keys(pkg.dependencies)) {
      expect(RUNTIME_PACKAGES, `add ${dep} to RUNTIME_PACKAGES in compat.test.ts`).toContain(dep);
    }
  });
});
