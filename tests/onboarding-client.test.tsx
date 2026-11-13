await import("./dom");
import { afterEach, expect, test } from "bun:test";
const { render, screen, cleanup, fireEvent } = await import("@testing-library/react");
import { OnboardingCards } from "../src/client/Onboarding";
afterEach(cleanup);
test("ready subscription sessions show versions and select their exact provider", () => {
  const chosen: string[] = [];
  render(<OnboardingCards providers={[{id:"claude",state:"ready",version:"1.2",path:"/bin/claude"},{id:"codex",state:"ready",version:"3.4"}]} onUse={mode => chosen.push(mode)} />);
  expect(screen.getAllByText("Ready")).toHaveLength(2);
  expect(screen.getByText(/1.2/)).toBeTruthy();
  expect(screen.getByText(/3.4/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Use Claude Code"}));
  fireEvent.click(screen.getByRole("button",{name:"Use Codex"}));
  expect(chosen).toEqual(["claude-code","codex-cli"]);
});
for (const [state,label] of [["install","Install"],["signin","Sign in"],["error","Retry"]] as const) {
  test(`${state} has one useful state and no login/install action`, () => {
    render(<OnboardingCards providers={[{id:"claude",state}]} onUse={() => {throw Error("unexpected action");}} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByRole("button",{name:"Use Claude Code"})).toBeNull();
  });
}
test("authenticated discovery selects the CLI mode through config", async () => {
  const { Onboarding } = await import("../src/client/Onboarding");
  const { waitFor } = await import("@testing-library/react");
  const original = globalThis.fetch;
  const calls: {url: string; init?: RequestInit}[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    calls.push({url: String(url), init});
    return Response.json(String(url).endsWith("/control-session") ? {csrf:"test"} : String(url).endsWith("/providers") ? [{id:"codex",state:"ready"}] : {});
  }) as typeof fetch;
  try {
    let selected = false;
    render(<Onboarding agentId="agent" onSelected={() => {selected = true;}} />);
    fireEvent.click(await screen.findByRole("button", {name:"Use Codex"}));
    await waitFor(() => expect(selected).toBe(true));
    const config = calls.find(call => call.url === "/api/config")!;
    expect(config.init?.method).toBe("PUT");
    expect(JSON.parse(config.init?.body as string)).toEqual({agentId:"agent",mode:"codex-cli"});
    expect(calls.find(call => call.url === "/api/providers")?.init?.credentials).toBe("same-origin");
  } finally { globalThis.fetch = original; }
});
