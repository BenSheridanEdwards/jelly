import { test, expect } from "bun:test";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexProvider } from "../src/server/codex-provider";

test("Codex JSONL streams incremental agent text before completion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jelly-codex-"));
  try {
    const path = join(dir, "codex");
    await writeFile(path, `#!/usr/bin/env bun
if (process.argv.includes('--version')) { console.log('codex-cli 1.0'); process.exit(); }
if (process.argv.includes('login')) { console.log('Logged in using ChatGPT'); process.exit(); }
let initialized = false;
for await (const line of console) {
 const r = JSON.parse(line);
 const emit = x => console.log(JSON.stringify(x));
 if (r.method === 'initialize') emit({id:r.id,result:{}});
 else if (r.method === 'initialized') initialized = true;
 else if (r.method === 'thread/start' && initialized) emit({id:r.id,result:{thread:{id:'thread'}}});
 else if (r.method === 'turn/start') {
  emit({id:r.id,result:{turn:{id:'turn'}}});
  for (const delta of ['Hello', ' world']) {
   emit({method:'item/agentMessage/delta',params:{delta}});
   await Bun.sleep(30);
  }
  emit({method:'turn/completed',params:{turn:{status:'completed'}}});
 }
}
`);
    await chmod(path, 0o755);
    const provider = createCodexProvider(() => ({ id: "codex", state: "ready", path }));
    const model = provider.getModels()[0]!;
    const events = provider.streamSimple(model, { messages: [{ role: "user", content: "hello", timestamp: Date.now() }] } as any);
    const deltas: string[] = [];
    let completed = false;
    for await (const event of events) {
      if (event.type === "text_delta") { expect(completed).toBe(false); deltas.push(event.delta); }
      if (event.type === "done") completed = true;
      if (event.type === "error") throw new Error(event.error.errorMessage);
    }
    expect(deltas).toEqual(["Hello", " world"]);
    expect(completed).toBe(true);
  } finally { await rm(dir, { recursive: true }); }
});
