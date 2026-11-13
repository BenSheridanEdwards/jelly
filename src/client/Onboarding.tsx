import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Mode } from "../shared/types";

export type Provider = { id: "claude" | "codex"; state: "ready" | "signin" | "install" | "error"; version?: string; path?: string; disconnected?: boolean };
type CliMode = "claude-code" | "codex-cli";
const labels = { ready: "Ready", signin: "Sign in", install: "Install", error: "Retry" };
export function HostChoice({onLocal, navigate = url => window.location.assign(url)}: {onLocal: () => void; navigate?: (url: string) => void}) {
 const [url, setUrl] = useState("");
 const [error, setError] = useState("");
 return <section aria-label="Choose a Jelly host">
  <h2>Choose a Jelly host</h2>
  <p>Desktop CLIs live on the computer running Jelly. On a phone, connecting to an existing host is the usual path.</p>
  <button type="button" onClick={onLocal}>Use this device as the Jelly host</button>
  <form onSubmit={event => {
   event.preventDefault();
   try {
    const target = new URL(url.trim());
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) throw Error();
    setError(""); navigate(target.href);
   } catch { setError("Enter an http or https Jelly host URL."); }
  }}>
   <label>Existing Jelly host URL<input value={url} onChange={event=>setUrl(event.target.value)} /></label>
   <button type="submit">Connect to existing host</button>
   {error && <p role="alert">{error}</p>}
  </form>
 </section>;
}
function usePhoneLayout() {
 const [mobile, setMobile] = useState(() => window.matchMedia?.("(max-width: 767px)").matches ?? false);
 useEffect(() => {
  const query = window.matchMedia?.("(max-width: 767px)");
  if (!query) return;
  const update = () => setMobile(query.matches);
  query.addEventListener("change", update);
  return () => query.removeEventListener("change", update);
 }, []);
 return mobile;
}
export function OnboardingCards({ providers, onUse, onAction, reconnect = false, hostName, mobile = false }: { hostName?: string; mobile?: boolean; reconnect?: boolean; providers: Provider[]; onUse: (mode: CliMode) => void; onAction?: (provider: Provider) => void }) {
  return <section aria-label="Set up a provider">
    <h2>Use your existing subscription</h2>
    {mobile && <><p>Connected Jelly host: {hostName || "this Jelly server"}</p><p>These providers and desktop CLIs belong to the computer running Jelly. Actions run on that host.</p></>}
    {providers.map(provider => <article key={provider.id}>
      <h3>{provider.id === "claude" ? "Claude Code" : "Codex"}</h3>
      {provider.path && <p>{provider.path}</p>}
      {provider.version && <p>Version {provider.version}</p>}
      {provider.state === "ready" ? <p>Ready</p> : <button type="button" onClick={() => onAction?.(provider)}>{labels[provider.state]}{mobile ? " on host" : ""}</button>}
      {provider.state === "ready" && <button type="button" onClick={() => onUse(provider.id === "claude" ? "claude-code" : "codex-cli")}>{reconnect ? "Reconnect Jelly" : `Use ${provider.id === "claude" ? "Claude Code" : "Codex"}`}</button>}
    </article>)}
  </section>;
}
export function Onboarding({ agentId, onSelected, only, hostName }: { hostName?: string; agentId?: string; onSelected: (mode?: Mode) => void; only?: Provider["id"] }) {
  const mobile = usePhoneLayout();
  const [hostChosen, setHostChosen] = useState(false);
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
    finally { running.current = null; setAction(null); try { setProviders(await api<Provider[]>("/providers")); if (only) onSelected(); } catch { setError("Could not refresh. Try again."); } }
  }
  async function select(mode: CliMode, disconnect = false) {
    setBusy(true);
    setError("");
    try {
      if (only) {
        const result = await api<{mode: Mode}>(`/providers/${only}/${disconnect ? "disconnect" : "reconnect"}`, { method: "POST", body: "{}" });
        setProviders(await api<Provider[]>("/providers"));
        onSelected(result.mode ?? (disconnect ? "auto" : mode));
      } else {
        await api(`/providers/${mode === "claude-code" ? "claude" : "codex"}/reconnect`, { method: "POST", body: "{}" });
        await api("/config", { method: "PUT", body: JSON.stringify({ agentId, mode }) });
        onSelected(mode);
      }
    } catch { setError("Could not select provider. Try again."); }
    finally { setBusy(false); }
  }
  return <fieldset disabled={busy} style={{ border: 0, margin: 0, minWidth: 0 }}>

    {!only && !hostChosen && <HostChoice onLocal={() => setHostChosen(true)} />}
    <button type="button" onClick={() => void api<Provider[]>("/providers").then(value => { setProviders(value); if (only) onSelected(); }).catch(() => setError("Could not refresh. Try again."))}>Recheck CLI sessions</button>
    <OnboardingCards mobile={mobile} hostName={hostName} reconnect={!!only} providers={providers.filter(p => !only || p.id === only)} onUse={mode => void select(mode)} onAction={provider => void act(provider)} />
    {only && <p>Disconnect Jelly stops using this subscription here. The official CLI stays signed in.</p>}
    {only && <button type="button" onClick={() => void select(only === "claude" ? "claude-code" : "codex-cli", true)}>Disconnect Jelly</button>}
    {action && <button type="button" onClick={() => action.abort()}>Cancel</button>}
    {progress && <pre role="status">{progress}</pre>}
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
