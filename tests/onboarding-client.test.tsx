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
  test(`${state} offers an action`, () => {
    const actions: string[] = [];
    render(<OnboardingCards onAction={p => actions.push(p.state)} providers={[{id:"claude",state}]} onUse={() => {throw Error("unexpected action");}} />);
    fireEvent.click(screen.getByRole("button", {name:label}));
    expect(actions).toEqual([state]);
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
for (const outcome of ["Completed", "Action failed or cancelled. Retry."]) test(`action stream ${outcome} supports retry and completion`, async () => {
 const {Onboarding} = await import("../src/client/Onboarding");
 const {waitFor} = await import("@testing-library/react");
 const original = globalThis.fetch; let posts = 0;
 globalThis.fetch = (async (url:any) => {
  if (String(url).endsWith("/control-session")) return Response.json({csrf:"fake"});
  if (String(url).endsWith("/providers")) return Response.json([{id:"codex",state:posts && outcome === "Completed" ? "ready":"signin"}]);
  posts++;
  const data = JSON.stringify({text:"User code: ABCD-EFGH"})+"\n"+JSON.stringify({text:outcome});
  return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(data.slice(0,7))); c.enqueue(new TextEncoder().encode(data.slice(7)));c.close();}}));
 }) as typeof fetch;
 try {
  render(<Onboarding agentId="fake" onSelected={()=>{}}/>);
  fireEvent.click(await screen.findByRole("button",{name:"Sign in"}));
  await waitFor(()=>expect(screen.getByRole("status").textContent).toContain("ABCD-EFGH"));
  if(outcome === "Completed") expect(await screen.findByRole("button",{name:"Use Codex"})).toBeTruthy();
  else { expect(await screen.findByRole("alert")).toBeTruthy(); fireEvent.click(screen.getByRole("button",{name:"Sign in"})); await waitFor(()=>expect(posts).toBe(2)); }
 } finally {globalThis.fetch=original;}
});
for (const cancel of [true,false]) test(`pending action aborts on ${cancel ? "Cancel":"unmount"}`, async () => {
 const {Onboarding} = await import("../src/client/Onboarding");
 const {waitFor} = await import("@testing-library/react");
 const original = globalThis.fetch; let signal: AbortSignal | undefined;
 globalThis.fetch = (async (url:any, init?:RequestInit) => {
  if(String(url).endsWith("/control-session")) return Response.json({csrf:"fake"});
  if(String(url).endsWith("/providers")) return Response.json([{id:"codex",state:"install"}]);
  signal = init?.signal as AbortSignal;
  return new Promise((_,reject)=>signal!.addEventListener("abort",()=>reject(Error("aborted"))));
 }) as typeof fetch;
 try {
  const view = render(<Onboarding agentId="fake" onSelected={()=>{}}/>);
  fireEvent.click(await screen.findByRole("button",{name:"Install"}));
  await waitFor(()=>expect(signal).toBeTruthy());
  if(cancel) fireEvent.click(screen.getByRole("button",{name:"Cancel"})); else view.unmount();
  await waitFor(()=>expect(signal!.aborted).toBe(true));
 } finally {globalThis.fetch=original;}
});

test("connections offer explicit recheck", async () => {
 const {Onboarding} = await import("../src/client/Onboarding");
 const original = globalThis.fetch;
 globalThis.fetch = (async () => Response.json([{id:"codex",state:"ready"}])) as typeof fetch;
 try { render(<Onboarding agentId="fake" onSelected={()=>{}}/>); expect(await screen.findByRole("button",{name:"Recheck CLI sessions"})).toBeTruthy(); }
 finally {globalThis.fetch=original;}
});

for (const [id, mode, label] of [["claude", "claude-code", "Claude"], ["codex", "codex-cli", "Codex"]] as const) test(`${label} Settings rechecks, reconnects and disconnects Jelly only`, async () => {
 const { Settings } = await import("../src/client/Settings");
 const { waitFor } = await import("@testing-library/react");
 const original = globalThis.fetch; const calls: string[] = []; let ready = true;
 globalThis.fetch = (async (url: any, init?: RequestInit) => {
  calls.push(`${init?.method ?? "GET"} ${url}`);
  return Response.json(String(url).endsWith("/control-session") ? {csrf:"test"} : String(url).endsWith("/providers") ? [{id,state:ready ? "ready":"signin",path:`/fake/${id}`}] : {});
 }) as typeof fetch;
 try {
  const config = {mode:"auto",selectedModel:"gpt-6-astra",effort:"medium"};
  render(<Settings data={{config,agents:[],instance:{}} as any} theme="system" setTheme={()=>{}} onClose={()=>{}} refresh={async()=>{}}/>);
  fireEvent.click(screen.getByRole("button",{name:`${label} subscription`}));
  fireEvent.click(await screen.findByRole("button",{name:"Reconnect Jelly"}));
  await waitFor(()=>expect(calls).toContain(`POST /api/providers/${id}/reconnect`));
  fireEvent.click(screen.getByRole("button",{name:"Disconnect Jelly"}));
  await waitFor(()=>expect(calls).toContain(`POST /api/providers/${id}/disconnect`));
  ready = false; fireEvent.click(screen.getByRole("button",{name:"Recheck CLI sessions"}));
  expect(await screen.findByRole("button",{name:"Sign in"})).toBeTruthy();
  expect(calls.filter(call=>call === "GET /api/providers").length).toBeGreaterThan(1);
  expect(calls.some(call=>/logout|\/config/.test(call))).toBe(false);
 } finally {globalThis.fetch=original;}
});
