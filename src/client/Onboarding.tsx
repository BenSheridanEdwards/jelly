import { useEffect, useRef, useState } from "react";
import { api } from "./api";

type Provider = { id: "claude" | "codex"; state: "ready" | "signin" | "install" | "error"; version?: string; path?: string };
type CliMode = "claude-code" | "codex-cli";
const labels = { ready: "Ready", signin: "Sign in", install: "Install", error: "Retry" };
export function OnboardingCards({ providers, onUse, onAction }: { providers: Provider[]; onUse: (mode: CliMode) => void; onAction?: (provider: Provider) => void }) {
  return <section aria-label="Set up a provider">
    <h2>Use your existing subscription</h2>
    {providers.map(provider => <article key={provider.id}>
      <h3>{provider.id === "claude" ? "Claude Code" : "Codex"}</h3>
      {provider.path && <p>{provider.path}</p>}
      {provider.version && <p>Version {provider.version}</p>}
      {provider.state === "ready" ? <p>Ready</p> : <button type="button" onClick={() => onAction?.(provider)}>{labels[provider.state]}</button>}
      {provider.state === "ready" && <button type="button" onClick={() => onUse(provider.id === "claude" ? "claude-code" : "codex-cli")}>Use {provider.id === "claude" ? "Claude Code" : "Codex"}</button>}
    </article>)}
  </section>;
}
export function Onboarding({ agentId, onSelected }: { agentId: string; onSelected: () => void }) {
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [error, setError] = useState("");
  const [action, setAction] = useState<AbortController | null>(null);
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void api<Provider[]>("/providers").then(value => { if (active) setProviders(value); }).catch(() => {
      if (active) setProviders([{ id: "claude", state: "error" }, { id: "codex", state: "error" }]);
    });
    return () => { active = false; };
  }, []);
  async function act(provider: Provider) {
    if (action) return;
    if (provider.state === "error") { try { setProviders(await api<Provider[]>("/providers")); } catch { setError("Could not refresh. Try again."); } return; }
    const controller = new AbortController(); running.current = controller; setAction(controller); setError(""); setProgress("");
    try {
      const {csrf} = await api<{csrf:string}>("/control-session");
      const response = await fetch(`/api/providers/${provider.id}/${provider.state}`, {method:"POST", credentials:"same-origin", headers:{"x-jelly-csrf":csrf}, signal:controller.signal});
      if (!response.ok || !response.body) throw Error();
      const reader = response.body.getReader(); const decoder = new TextDecoder();
      let pending = "", completed = false;
      const consume = (line: string) => {
        if (!line.trim()) return;
        const {text} = JSON.parse(line);
        if (typeof text !== "string" || /token|secret|password|bearer|sk-|credential|cookie/i.test(text)) return;
        if (text === "Action failed or cancelled. Retry.") throw Error();
        if (text === "Completed") completed = true;
        setProgress(value => (value + text + "\n").slice(-8192));
      };
      for (;;) {
        const {done,value} = await reader.read();
        pending += decoder.decode(value,{stream:!done});
        const lines = pending.split("\n"); pending = lines.pop()!;
        lines.forEach(consume);
        if (done) { consume(pending); break; }
      }
      if (!completed) throw Error();
    } catch { setError("Action failed or cancelled. Try again."); }
    finally { running.current = null; setAction(null); try { setProviders(await api<Provider[]>("/providers")); } catch { setError("Could not refresh. Try again."); } }
  }
  async function select(mode: CliMode) {
    setBusy(true);
    setError("");
    try {
      await api("/config", { method: "PUT", body: JSON.stringify({ agentId, mode }) });
      onSelected();
    } catch { setError("Could not select provider. Try again."); }
    finally { setBusy(false); }
  }
  return <fieldset disabled={busy} style={{ border: 0, margin: 0, minWidth: 0 }}>

    <button type="button" onClick={() => void api<Provider[]>("/providers").then(setProviders).catch(() => setError("Could not refresh. Try again."))}>Recheck CLI sessions</button>
    <OnboardingCards providers={providers} onUse={mode => void select(mode)} onAction={provider => void act(provider)} />
    {action && <button type="button" onClick={() => action.abort()}>Cancel</button>}
    {progress && <pre role="status">{progress}</pre>}
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
