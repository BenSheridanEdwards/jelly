# First-run onboarding evidence receipts

Collected on Ben's Mac Studio on 13 Nov 2026 between 18:52:13 and 18:52:34 GMT (Europe/London). Head of `main` was `19d2e6f` ([feat: choose a local or remote Jelly host and show host-owned providers on the phone](https://github.com/BenSheridanEdwards/jelly/pull/10)).

These receipts close the remaining acceptance for [First-run onboarding: detect Claude Code and Codex and use existing subscription logins](https://github.com/BenSheridanEdwards/jelly/issues/1). Deterministic discovery and auth-state tests already landed in earlier slices. This folder is the recorded walkthrough plus live subscription-backed conversation receipts.

## How they were collected

- Jelly was started from a throwaway clone of that `main` revision, as the same OS user, with the real Homebrew `claude` (2.1.319) and `codex` (0.167.2) on PATH.
- Immediately before the run, `claude auth status` reported `loggedIn: true`, `authMethod: claude.ai`, `subscriptionType: max`, and `codex login status` reported `Logged in using ChatGPT`.
- The server used an isolated `JELLY_DATA_DIR` and `JELLY_CONFIG_DIR`. The host `~/.jelly` was not read or written. The official jelly checkout was not used.
- No OpenAI or Anthropic API key was present in the server environment. `apiReady` stayed false.
- No `claude auth login`, `codex login`, provider logout, or install command was run.
- Conversations were driven through Jelly's session+CSRF API (`GET /api/providers`, `PUT /api/config`, `POST /api/agents/.../messages`, `POST /api/agents/.../stop`, `GET /api/events`). Prompts were short and asked the CLIs not to use tools.
- Fresh-setup states were recorded with an isolated `HOME` and a `PATH` that could not see the host CLIs, using fake binaries only.

## Receipts

- [Existing-login discovery](existing-login-discovery.md): both CLIs were `ready` and offered without signing in again. Auto selected the Claude Code subscription route, not a paid API key.
- [Fresh setup (isolated)](fresh-setup-isolated.md): missing binaries report `install`; present but signed-out fakes report `signin`; ready fakes report `ready`.
- [Claude Code / Claude Max conversation](conversation-claude-code.md): `activeMode` `claude-code`, notice names the Claude Code subscription, a mid-turn `/stop` cancelled after streamed text `1. January:`, and a later turn on the same agent completed with `pong`.
- [Codex / ChatGPT conversation](conversation-codex-cli.md): `activeMode` `codex-cli`, notice names the Codex ChatGPT subscription, a mid-turn `/stop` cancelled, and a later turn on the same agent completed with `pong`. `chatgptReady: false` is Jelly's separate ChatGPT device-code connection, not the Codex CLI.
- [Restart recheck](restart-recheck.md): after stopping and starting the isolated server, both CLIs were still `ready` with no login in between.

Phone-sized onboarding copy and host choice were landed and component-tested in [feat: choose a local or remote Jelly host and show host-owned providers on the phone](https://github.com/BenSheridanEdwards/jelly/pull/10). This receipt run did not drive a phone browser.

Tokens, cookies, CSRF values, and emails were kept out of these files.
