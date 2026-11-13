import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { discoverProviders } from "../src/server/providers";

test("discovers subscription Codex outside PATH and reports missing binaries", async () => {
  const home = resolve(await mkdtemp(join(tmpdir(), "jelly-discovery-")));
  const env = { HOME: home, PATH: "/usr/bin:/bin", SHELL: "/bin/sh" };
  const missing = await discoverProviders(env, false);
  expect(missing.find(p => p.id === "codex")?.state).toBe("install");
  await mkdir(join(home, ".local/bin"), { recursive: true });
  const path = join(home, ".local/bin/codex");
  await writeFile(path, '#!/bin/sh\ncase "$1" in --version) echo "codex-cli 0.162.1";; *) echo "Logged in using ChatGPT";; esac\n', { mode: 0o755 });
  expect((await discoverProviders(env, false)).find(p => p.id === "codex")).toEqual({ id: "codex", state: "ready", version: "0.162.1", path });
});

 test("fake sign-in uses discovered path and isolated environment", async () => {
 const home = resolve(await mkdtemp(join(tmpdir(), "jelly-action-")));
 await mkdir(join(home, ".local/bin"), {recursive:true});
 await writeFile(join(home, ".local/bin/codex"), '#!/bin/sh\n[ "$2" = "--device-auth" ] || exit 1\necho device-code\n', {mode:0o755});
 const {providerRuntimes} = await import("../src/server/providers");
 await providerRuntimes({HOME:home,PATH:""}, undefined, false).codex.signIn();
 });
