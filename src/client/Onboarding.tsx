import { useEffect, useState } from "react";
import { api } from "./api";

type Provider = { id: "claude" | "codex"; state: "ready" | "signin" | "install" | "error"; version?: string; path?: string };
type CliMode = "claude-code" | "codex-cli";
const labels = { ready: "Ready", signin: "Sign in", install: "Install", error: "Retry" };
export function OnboardingCards({ providers, onUse }: { providers: Provider[]; onUse: (mode: CliMode) => void }) {
  return <section aria-label="Set up a provider">
    <h2>Use your existing subscription</h2>
    {providers.map(provider => <article key={provider.id}>
      <h3>{provider.id === "claude" ? "Claude Code" : "Codex"}</h3>
      {provider.path && <p>{provider.path}</p>}
      {provider.version && <p>Version {provider.version}</p>}
      <p>{labels[provider.state]}</p>
      {provider.state === "ready" && <button type="button" onClick={() => onUse(provider.id === "claude" ? "claude-code" : "codex-cli")}>Use {provider.id === "claude" ? "Claude Code" : "Codex"}</button>}
    </article>)}
    <p>Sign-in and installation actions are coming in a later update. Other connections are available in Settings.</p>
  </section>;
}
export function Onboarding({ agentId, onSelected }: { agentId: string; onSelected: () => void }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void api<Provider[]>("/providers").then(value => { if (active) setProviders(value); }).catch(() => {
      if (active) setProviders([{ id: "claude", state: "error" }, { id: "codex", state: "error" }]);
    });
    return () => { active = false; };
  }, []);
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
    <OnboardingCards providers={providers} onUse={mode => void select(mode)} />
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
