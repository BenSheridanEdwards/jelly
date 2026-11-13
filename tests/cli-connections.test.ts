import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

for (const [id, mode] of [["claude", "claude-code"], ["codex", "codex-cli"]] as const) {
  test(`${id} restart rechecks login; disconnect persists without CLI logout`, async () => {
    const home = resolve(mkdtempSync(join(tmpdir(), "jelly-cli-connections-")));
    const bin = join(home, ".local/bin"); mkdirSync(bin, { recursive: true });
    for (const provider of ["claude", "codex"]) writeFileSync(join(bin, provider), `#!/bin/sh
printf '%s %s\\n' '${provider}' "$*" >> "$HOME/invocations"
case "$*" in
'--version') echo 'codex-cli 1.0';;
'auth status') [ ! -f "$HOME/signedout" ] || exit 1; echo '{"loggedIn":true,"subscriptionType":"max"}';;
'login status') [ ! -f "$HOME/signedout" ] || exit 1; echo 'Logged in using ChatGPT';;
*) exit 99;; esac
`, { mode: 0o755 });
    const launch = async () => {
      const code = `import {startApp} from './src/server/app'; const app = await startApp({dataDir:process.env.HOME+'/data',port:0,desktopOptions:{cliPath:null}}); console.log('URL '+app.server.url); process.on('SIGTERM',async()=>{await app.close();process.exit(0)});`;
      const child = Bun.spawn([process.execPath, "-e", code], { cwd: resolve(import.meta.dir, ".."),
        env: { HOME: home, PATH: bin, SHELL: "/bin/false", TMPDIR: tmpdir() }, stdout: "pipe", stderr: "pipe" });
      const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
      const reader = child.stdout.getReader(); let output = "";
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) throw Error(output + await new Response(child.stderr).text()); output += new TextDecoder().decode(chunk.value); const url = output.match(/URL (http:\/\/\S+)/)?.[1]; if (url) return { child, url }; } }
      finally { clearTimeout(timer); reader.releaseLock(); }
    };
    let server = await launch();
    const request = async (path: string, method = "GET", value?: unknown) => {
      const session = await fetch(server.url + "api/control-session");
      const response = await fetch(server.url + "api/" + path, { method, headers: { "Content-Type": "application/json", cookie: session.headers.get("set-cookie")!.split(";")[0]!, "x-jelly-csrf": (await session.json()).csrf }, body: value === undefined ? undefined : JSON.stringify(value) });
      expect(response.status).toBe(200); return response.json();
    };
    const restart = async () => { server.child.kill("SIGKILL"); await server.child.exited; server = await launch(); };
    try {
      const first = await request("state"); const agentId = first.agents[0].id;
      await request("config", "PUT", { agentId, mode });
      await restart();
      let state = await request("state");
      expect(state.config).toMatchObject({ mode, activeMode: mode, ready: true });
      expect((await request(`state?agentId=${agentId}`)).agentConfig).toMatchObject({ activeMode: mode, ready: true });
      writeFileSync(join(home, "signedout"), ""); await restart();
      state = await request("state"); expect(state.config).toMatchObject({ mode, ready: false });
      expect((await request("providers")).find((p: any) => p.id === id).state).toBe("signin");
      renameSync(join(home, "signedout"), join(home, "old-signedout"));
      await request(`providers/${id}/reconnect`, "POST", {});
      expect((await request("state")).config).toMatchObject({ mode, ready: true });
      await request(`providers/${id}/disconnect`, "POST", {});
      await restart(); state = await request("state");
      expect(state.config.activeMode).not.toBe(mode);
      expect((await request(`state?agentId=${agentId}`)).agentConfig.ready).toBe(false);
      const discovered = (await request("providers")).find((p: any) => p.id === id);
      expect(discovered).toMatchObject({ state: "ready", disconnected: true, path: join(bin, id) });
      expect(readFileSync(join(home, "invocations"), "utf8")).not.toMatch(/logout|auth login|device-auth|install/);
      await request(`providers/${id}/reconnect`, "POST", {});
      expect((await request(`state?agentId=${agentId}`)).agentConfig.ready).toBe(true);
    } finally {
      server.child.kill("SIGTERM"); await server.child.exited;
      const trash = join(process.env.HOME!, ".Trash", home.split("/").at(-1)!);
      renameSync(home, trash);
    }
  }, 30000);
}
