import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { ClaudeCodeConnection } from "../claude-code";

export type ProviderId = "claude" | "codex";
export interface ProviderStatus {
  id: ProviderId;
  state: "install" | "signin" | "ready" | "error";
  version?: string;
  path?: string;
}
export interface ProviderRuntime {
  discover(): Promise<ProviderStatus>;
  status(): Promise<ProviderStatus>;
  signIn(): Promise<void>;
  start(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
}
async function run(path: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = Bun.spawn([path, ...args], { env, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 5000);
  try {
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    return { text: out + err, code };
  } finally { clearTimeout(timer); }
}
async function binary(id: ProviderId, env: NodeJS.ProcessEnv, systemPaths: boolean) {
  const home = env.HOME || "";
  const dirs = (env.PATH || "").split(":");
  for (const relative of [".local/bin", ".npm-global/bin", ".npm/bin", ".volta/bin", ".local/share/mise/shims", ".local/share/mise/installs/node"]) {
    dirs.push(join(home, relative));
  }
  for (const root of [".nvm/versions/node", ".local/share/mise/installs/node"]) {
    const base = join(home, root);
    for (const version of await readdir(base).catch(() => [] as string[])) dirs.push(join(base, version, "bin"));
  }
  // Probe only the caller's login shell and preserve its isolated HOME.
  if (systemPaths && env.SHELL) {
    try {
      const result = await run(env.SHELL, ["-lc", 'printf "%s" "$PATH"'], env);
      if (result.code === 0) dirs.push(...result.text.split(":"));
    } catch { /* Known locations remain available. */ }
  }
  if (systemPaths) dirs.push("/opt/homebrew/bin", "/usr/local/bin");
  for (const dir of new Set(dirs.filter(Boolean))) {
    const path = join(dir, id);
    try { await access(path, constants.X_OK); return path; } catch { /* Try next location. */ }
  }
}
export function providerRuntimes(env: NodeJS.ProcessEnv = process.env, claude = new ClaudeCodeConnection(), systemPaths = true): Record<ProviderId, ProviderRuntime> {
  const unsupported = async () => { throw new Error("Provider action is not implemented yet"); };
  const create = (id: ProviderId): ProviderRuntime => {
    const status = async (): Promise<ProviderStatus> => {
      const path = await binary(id, env, systemPaths);
      if (!path) return { id, state: "install" };
      try {
        if (id === "claude") {
          const result = await claude.refresh();
          return { id, path, state: result.claudeReady ? "ready" : "signin" };
        }
        const versionResult = await run(path, ["--version"], env);
        const version = versionResult.text.match(/codex-cli\s+(\S+)/)?.[1];
        if (versionResult.code !== 0 || !version) return { id, path, state: "error" };
        const auth = await run(path, ["login", "status"], env);
        return { id, path, version, state: auth.code === 0 && /Logged in using ChatGPT/i.test(auth.text) ? "ready" : "signin" };
      } catch { return { id, path, state: "error" }; }
    };
    return { discover: status, status, signIn: unsupported, start: unsupported, resume: unsupported, stop: unsupported };
  };
  return { claude: create("claude"), codex: create("codex") };
}
export async function discoverProviders(env: NodeJS.ProcessEnv = process.env, systemPaths = true): Promise<ProviderStatus[]> {
  return Promise.all(Object.values(providerRuntimes(env, undefined, systemPaths)).map(provider => provider.discover()));
}
