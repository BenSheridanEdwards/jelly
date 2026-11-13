await import("./dom");
import { afterEach, expect, test } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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
