import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The Claude desktop app reads MCP servers from claude_desktop_config.json:
 *   { "mcpServers": { "pokeeclaude": { "command": "...", "args": [...], "env": {...} } } }
 */

export const SERVER_NAME = "pokeeclaude";

type Json = Record<string, unknown>;

export interface McpServerEntry {
  readonly command: string;
  readonly args: string[];
  readonly env?: Record<string, string>;
}

export function claudeDesktopConfigPath(platform = process.platform, env = process.env): string {
  if (env.CLAUDE_DESKTOP_CONFIG) return env.CLAUDE_DESKTOP_CONFIG;
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (platform === "win32") return join(env.APPDATA || join(homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "Claude", "claude_desktop_config.json");
}

/**
 * How the app should start our MCP server. From the installed PokeeClaude app
 * we launch the app binary itself in Node mode (no Node.js needed, and no
 * shell script, which Windows can't spawn directly).
 */
export function mcpEntry(runner: { exec: string; cli: string; asNode: boolean }): McpServerEntry {
  return {
    command: runner.exec,
    args: [runner.cli, "mcp"],
    ...(runner.asNode ? { env: { ELECTRON_RUN_AS_NODE: "1" } } : {}),
  };
}

export function addMcpServer(config: Json, entry: McpServerEntry): Json {
  const servers = isRecord(config.mcpServers) ? config.mcpServers : {};
  return { ...config, mcpServers: { ...servers, [SERVER_NAME]: entry } };
}

export function removeMcpServer(config: Json): Json {
  if (!isRecord(config.mcpServers) || !(SERVER_NAME in config.mcpServers)) return config;
  const { [SERVER_NAME]: _removed, ...rest } = config.mcpServers;
  return { ...config, mcpServers: rest };
}

export function getMcpServer(config: Json): McpServerEntry | null {
  const entry = isRecord(config.mcpServers) ? config.mcpServers[SERVER_NAME] : undefined;
  return isRecord(entry) && typeof entry.command === "string" ? (entry as unknown as McpServerEntry) : null;
}

function isRecord(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
