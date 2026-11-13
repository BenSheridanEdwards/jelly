import { createProvider, getCurrentSystemPrompt, createAssistantMessageEventStream, type AssistantMessage, type Model, type TranscriptContext, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type { ProviderStatus } from "./providers";

export function createCodexProvider(status: () => ProviderStatus | undefined) {
  const threads = new Map<string, string>();
  function stream(model: Model<any>, context: TranscriptContext, options?: SimpleStreamOptions) {
    const events = createAssistantMessageEventStream();
    const message: AssistantMessage = {
      role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: [{ type: "text", text: "" }], timestamp: Date.now(), stopReason: "stop",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    void (async () => {
      let child: ReturnType<typeof Bun.spawn> | undefined;
      try {
        const provider = status();
        if (provider?.state !== "ready" || !provider.path) throw new Error("Codex ChatGPT login is required");
        const login = Bun.spawn([provider.path, "login", "status"], { stdout: "pipe", stderr: "pipe" });
        const loginTimer = setTimeout(() => login.kill(), 5000);
        try {
          const [out, err, code] = await Promise.all([new Response(login.stdout).text(), new Response(login.stderr).text(), login.exited]);
          if (code !== 0 || !/Logged in using ChatGPT/i.test(out + err)) throw new Error("Codex ChatGPT subscription login is required");
        } finally { clearTimeout(loginTimer); }
        child = Bun.spawn([provider.path, "app-server"], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
        const proc = child;
        let id = 0;
        const send = (method: string, params: unknown, request = true) => {
          const next = ++id;
          (proc.stdin as Bun.FileSink).write(JSON.stringify({ ...(request ? { id: next } : {}), method, params }) + "\n");
          return next;
        };
        let threadId = "";
        let turnId = "";
        let interruptSent = false;
        let killTimer: ReturnType<typeof setTimeout> | undefined;
        const abort = () => {
          if (threadId && turnId && !interruptSent) {
            interruptSent = true;
            send("turn/interrupt", { threadId, turnId });
          }
          killTimer ??= setTimeout(() => proc.kill(), 5000);
        };
        options?.signal?.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(abort, 300000);
        try {
          options?.signal?.throwIfAborted();
          let phase = send("initialize", { clientInfo: { name: "jelly", version: "0.1.0" } });
          const sessionId = options?.sessionId;
          const resuming = !!sessionId && threads.has(sessionId);
          events.push({ type: "start", partial: message });
          events.push({ type: "text_start", contentIndex: 0, partial: message });
          let buffer = "";
          const decoder = new TextDecoder();
          for await (const chunk of proc.stdout as unknown as AsyncIterable<Uint8Array>) {
            buffer += decoder.decode(chunk, { stream: true });
            let newline: number;
            while ((newline = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
              if (!line.trim()) continue;
              const value = JSON.parse(line);
              if (value.error) throw new Error(value.error.message || "Codex protocol error");
              if (value.id === phase) {
                if (!threadId && value.result?.thread) {
                  threadId = value.result.thread.id;
                  if (sessionId) threads.set(sessionId, threadId);
                  const text = JSON.stringify(sessionId && threads.has(sessionId) && resuming ? context.messages.slice(-1) : context.messages);
                  phase = send("turn/start", { threadId, input: [{ type: "text", text }] });
                } else if (!threadId) {
                  send("initialized", {}, false);
                  phase = send(sessionId && threads.has(sessionId) ? "thread/resume" : "thread/start", { ...(sessionId && threads.has(sessionId) ? { threadId: threads.get(sessionId) } : {}), model: model.id, approvalPolicy: "never", sandbox: "read-only", baseInstructions: getCurrentSystemPrompt(context.messages) });
                }
              }
              if (value.result?.turn?.id || value.method === "turn/started") {
                turnId = value.result?.turn?.id ?? value.params.turn.id;
                if (options?.signal?.aborted) abort();
              }
              if (value.method === "item/agentMessage/delta") {
                const delta = value.params.delta;
                (message.content[0] as { text: string }).text += delta;
                events.push({ type: "text_delta", contentIndex: 0, delta, partial: message });
              }
              if (value.method === "turn/completed") {
                if (value.params.turn.status === "interrupted") {
                  message.stopReason = "aborted";
                  events.push({ type: "error", reason: "aborted", error: message }); events.end(); return;
                }
                if (value.params.turn.status !== "completed") throw new Error(value.params.turn.error?.message || "Codex turn failed");
                events.push({ type: "text_end", contentIndex: 0, content: (message.content[0] as { text: string }).text, partial: message });
                events.push({ type: "done", reason: "stop", message }); events.end(); return;
              }
              if (value.method && value.id !== undefined) throw new Error("Unsupported Codex server request: " + value.method);
            }
          }
          throw new Error("Codex app-server exited before completion");
        } finally { clearTimeout(timeout); clearTimeout(killTimer); options?.signal?.removeEventListener("abort", abort); }
      } catch (error) {
        message.stopReason = options?.signal?.aborted ? "aborted" : "error";
        message.errorMessage = error instanceof Error ? error.message : String(error);
        events.push({ type: "error", reason: message.stopReason, error: message }); events.end();
      } finally { child?.kill(); }
    })();
    return events;
  }
  return createProvider({ id: "codex-cli", name: "Codex ChatGPT", baseUrl: "process://codex",
    models: getBuiltinModels("openai-codex").map(model => ({ ...model, provider: "codex-cli", api: "codex-app-server", compat: undefined })),
    auth: { apiKey: { name: "Codex login", async check() { return status()?.state === "ready" ? { type: "oauth", source: "Codex ChatGPT" } : undefined; }, async resolve() { return { auth: { apiKey: "external-process" } }; } } },
    api: { stream, streamSimple: stream },
  });
}
