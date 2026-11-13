import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCodexProvider } from "../src/server/codex-provider";

test("Codex JSONL streams incremental agent text before completion", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "jelly-codex-"));
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
 else if (r.method === 'thread/start' && initialized) {
  await Bun.write(${JSON.stringify(join(dir, 'thread-start.json'))}, JSON.stringify(r.params));
  emit({id:r.id,result:{thread:{id:'thread'}}});
 }
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
    const params = JSON.parse(await readFile(join(dir, "thread-start.json"), "utf8"));
    expect(params.sandbox).toBe("read-only");
    expect(params.approvalPolicy).toBe("never");
    expect(params.cwd).toBeUndefined();
  } finally { await rm(dir, { recursive: true }); }
});

for (const interrupt of [false, true]) test(interrupt ? "interrupt waits for stopped completion" : "second turn resumes existing conversation", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "jelly-resume-"));
  const previousHome = process.env.HOME;
  process.env.HOME = dir;
  try {
    const path = join(dir, "codex");
    const record = join(dir, "requests.jsonl");
    await writeFile(path, `#!${process.execPath}
import { appendFileSync } from 'node:fs';
if (process.argv.includes('--version')) { console.log('codex-cli 1.0'); process.exit(); }
if (process.argv.includes('login')) { console.log('Logged in using ChatGPT'); process.exit(); }
const emit = x => console.log(JSON.stringify(x));
for await (const line of console) {
 const r = JSON.parse(line);
 appendFileSync(${JSON.stringify(record)}, JSON.stringify(r) + '\\n');
 if (r.method === 'initialize') emit({id:r.id,result:{}});
 if (r.method === 'thread/start' || r.method === 'thread/resume') emit({id:r.id,result:{thread:{id:'thread'}}});
 if (r.method === 'turn/start') {
  emit({id:r.id,result:{turn:{id:'turn'}}});
  emit({method:'item/agentMessage/delta',params:{delta:'hello'}});
  if (!${interrupt}) emit({method:'turn/completed',params:{turn:{id:'turn',status:'completed'}}});
 }
 if (r.method === 'turn/interrupt') {
  emit({id:r.id,result:{}});
  emit({method:'turn/completed',params:{turn:{id:'turn',status:'interrupted'}}});
 }
}
`);
    await chmod(path, 0o755);
    const provider = createCodexProvider(() => ({ id: "codex", state: "ready", path }));
    const controller = new AbortController();
    let terminal: any;
    for (let i = 0; i < (interrupt ? 1 : 2); i++) {
      for await (const event of provider.streamSimple(provider.getModels()[0]!, { messages: [{ role: "user", content: "hello", timestamp: 1 }] } as any, { sessionId: "conversation", signal: controller.signal })) {
        if (interrupt && event.type === "text_delta") controller.abort();
        if (event.type === "error" || event.type === "done") terminal = event;
      }
    }
    const requests = (await readFile(record, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    if (interrupt) {
      expect(requests.find(r => r.method === "turn/interrupt")?.params).toEqual({ threadId: "thread", turnId: "turn" });
      expect(terminal.reason).toBe("aborted");
      expect(terminal.error.errorMessage).not.toContain("Codex turn failed");
    } else {
      expect(requests.filter(r => r.method.startsWith("thread/")).map(r => r.method)).toEqual(["thread/start", "thread/resume"]);
      expect(terminal.type).toBe("done");
    }
  } finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    await rm(dir, { recursive: true });
  }
});
