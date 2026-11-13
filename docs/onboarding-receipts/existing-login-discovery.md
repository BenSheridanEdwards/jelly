# Existing-login discovery on Mac Studio

Recorded 2026-11-13 18:52:15 GMT. Jelly started as the same OS user with the real Homebrew `claude` and `codex` on PATH, and with isolated instance data (`JELLY_DATA_DIR` not `~/.jelly`).

Host CLI status immediately before this run (values redacted): Claude Code 2.1.319, `loggedIn: true`, `authMethod: claude.ai`, `subscriptionType: max`. Codex CLI 0.167.2, `Logged in using ChatGPT`. No API keys were set in the server environment.

Health: {"ok": true}. Instance name: This computer.

## GET /api/providers

```json
[
  {
    "id": "claude",
    "state": "ready",
    "disconnected": false,
    "path": "/opt/homebrew/bin/claude"
  },
  {
    "id": "codex",
    "state": "ready",
    "version": "0.167.2",
    "disconnected": false,
    "path": "/opt/homebrew/bin/codex"
  }
]
```

## Connection config (no API-key fallback)

```json
{
  "mode": "auto",
  "activeMode": "claude-code",
  "ready": true,
  "provider": "claude-code",
  "model": "gpt-6-astra",
  "claudeReady": true,
  "chatgptReady": false,
  "apiReady": false,
  "notice": "Claude Code subscription · Experimental; plan limits and provider billing rules apply.",
  "claudeNotice": "Claude Code subscription · Experimental; plan limits and provider billing rules apply."
}
```

apiReady=False; a paid API key was not configured for this isolated instance.
