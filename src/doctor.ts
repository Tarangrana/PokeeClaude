import { existsSync, readFileSync } from "node:fs";

import { getFromBridge } from "./bridge/send.js";
import { bridgePort, loadConfig } from "./config.js";
import { claudeSettingsPath, findPokeeCommands, readSettings } from "./install/claude-settings.js";
import { codexConfigPath, hasManagedNotify } from "./install/codex-config.js";
import { findPet, listPets } from "./pets.js";

type Status = "ok" | "warn" | "fail";

interface Check {
  readonly status: Status;
  readonly name: string;
  readonly detail: string;
}

export async function collectChecks(cliPath: string): Promise<Check[]> {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ status: major >= 20 ? "ok" : "fail", name: "Node.js", detail: process.versions.node });

  const settingsPath = claudeSettingsPath();
  try {
    const commands = findPokeeCommands(readSettings(settingsPath));
    if (commands.length === 0) {
      checks.push({ status: "warn", name: "Claude hooks", detail: `not installed in ${settingsPath} (run "pokeeclaude install")` });
    } else {
      const stale = commands.filter((c) => !c.includes(cliPath));
      checks.push(
        stale.length
          ? { status: "warn", name: "Claude hooks", detail: `point to another copy of PokeeClaude; run "pokeeclaude install" again` }
          : { status: "ok", name: "Claude hooks", detail: settingsPath },
      );
      if (cliPath.includes("_npx")) {
        checks.push({ status: "warn", name: "Hook path", detail: "hooks point into the npx cache, which can be cleaned up; prefer a global or cloned install" });
      }
    }
  } catch (error) {
    checks.push({ status: "fail", name: "Claude hooks", detail: `${settingsPath} is not valid JSON: ${String(error)}` });
  }

  const codexPath = codexConfigPath();
  const codex = existsSync(codexPath) && hasManagedNotify(readFileSync(codexPath, "utf8"));
  checks.push({ status: codex ? "ok" : "warn", name: "Codex notify", detail: codex ? codexPath : "not installed (optional: pokeeclaude install --codex)" });

  const pets = listPets();
  const config = loadConfig();
  const active = findPet(config.activePet);
  checks.push(
    pets.length === 0
      ? { status: "fail", name: "Pets", detail: 'none installed (run "pokeeclaude add pikachu")' }
      : { status: "ok", name: "Pets", detail: `${pets.length} installed, active: ${active?.metadata.displayName ?? pets[0]!.metadata.displayName}` },
  );

  const health = (await getFromBridge("/api/health")) as { name?: string; version?: string } | null;
  checks.push(
    health?.name === "pokeeclaude"
      ? { status: "ok", name: "Desktop pet", detail: `running on 127.0.0.1:${bridgePort()} (v${health.version})` }
      : { status: "warn", name: "Desktop pet", detail: `not running on 127.0.0.1:${bridgePort()} (run "pokeeclaude start")` },
  );
  return checks;
}

export async function runDoctor(cliPath: string): Promise<number> {
  const checks = await collectChecks(cliPath);
  const icon: Record<Status, string> = { ok: "✔", warn: "!", fail: "✘" };
  for (const check of checks) console.log(`${icon[check.status]} ${check.name.padEnd(13)} ${check.detail}`);
  return checks.some((c) => c.status === "fail") ? 1 : 0;
}
