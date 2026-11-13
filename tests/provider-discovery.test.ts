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

test("fake installer supports progress, failure, retry and cancellation", async () => {
 const home = resolve(await mkdtemp(join(tmpdir(), "jelly-install-")));
 const {providerRuntimes} = await import("../src/server/providers");
 const script = join(home,"installer");
 await writeFile(script, '#!/bin/sh\nexit 1\n', {mode:0o755});
 const runtime = providerRuntimes({HOME:home,PATH:""}, undefined, false, id => [script,"install","-g",id === "codex" ? "@openai/codex":"@anthropic-ai/claude-code"]).codex;
 await expect(runtime.install()).rejects.toThrow();
 await writeFile(script, '#!/bin/sh\nprintf \"%s\\n\" \"$*\" > \"$HOME/args\"\n/bin/mkdir -p "$HOME/.local/bin"\n/bin/echo "#!/bin/sh" > "$HOME/.local/bin/codex"\n/bin/chmod +x "$HOME/.local/bin/codex"\n');
 const progress: string[] = [];
 await runtime.install({onProgress: text => progress.push(text)});
 expect(progress.length).toBeGreaterThan(0);
 expect(await Bun.file(join(home,"args")).text()).toBe("install -g @openai/codex\n");
 expect((await runtime.status()).path).toBe(join(home,".local/bin/codex"));
 await writeFile(script, '#!/bin/sh\nexec /bin/sleep 30\n');
 const controller = new AbortController();
 const pending = runtime.install({signal:controller.signal});
 setTimeout(() => controller.abort(), 20);
 await expect(pending).rejects.toThrow("Cancelled");
});

test("both fake logins accept exact arguments and refresh to ready", async () => {
 const home = resolve(await mkdtemp(join(tmpdir(), "jelly-login-")));
 await mkdir(join(home,".local/bin"), {recursive:true});
 const {providerRuntimes} = await import("../src/server/providers");
 for (const id of ["claude","codex"] as const) {
   await writeFile(join(home,".local/bin",id), `#!/bin/sh
case "$*" in
"--version") echo "codex-cli 1.0";;
"auth status") test -f "$HOME/claude-ready" || exit 1; echo '{"loggedIn":true}';;
"login status") test -f "$HOME/codex-ready" || exit 1; echo 'Logged in using ChatGPT';;
"auth login"|"login --device-auth") /usr/bin/touch "$HOME/${id}-ready"; echo 'https://auth.openai.com/codex/device';;
*) exit 1;; esac
`, {mode:0o755});
   const runtime = providerRuntimes({HOME:home,PATH:""},undefined,false)[id];
   expect((await runtime.status()).state).toBe("signin");
   const progress: string[] = [];
   await runtime.signIn({onProgress: value => progress.push(value)});
   expect(progress).toContain("https://auth.openai.com/codex/device");
   expect((await runtime.status()).state).toBe("ready");
   await writeFile(join(home,".local/bin",id), '#!/bin/sh\nexit 1\n');
   await expect(runtime.signIn()).rejects.toThrow();
   await writeFile(join(home,".local/bin",id), '#!/bin/sh\nexec /bin/sleep 30\n');
   const controller = new AbortController();
   const pending = runtime.signIn({signal:controller.signal});
   setTimeout(() => controller.abort(),20);
   await expect(pending).rejects.toThrow("Cancelled");
 }
});

test("progress includes safe final stdout and stderr without credentials", async () => {
 const home = resolve(await mkdtemp(join(tmpdir(), "jelly-progress-")));
 const script = join(home,"fake");
 await writeFile(script, '#!/bin/sh\nprintf "Downloading package"\nprintf "Checking package" >&2\nprintf "\\naccess_token=private-secret"\n', {mode:0o755});
 const {providerRuntimes} = await import("../src/server/providers");
 const progress: string[] = [];
 await providerRuntimes({HOME:home,PATH:""},undefined,false,()=>[script]).codex.install({onProgress:t=>progress.push(t)});
 expect(progress.join("\n")).toContain("Downloading package");
 expect(progress.join("\n")).toContain("Checking package");
 expect(progress.join("\n")).not.toContain("private-secret");
});
