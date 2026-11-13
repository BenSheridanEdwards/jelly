# Fresh-setup walkthrough (isolated HOME/PATH, fake binaries only)

Recorded 2026-11-13 18:52:13 GMT. Real host CLIs were not signed out, installed, or logged in. Discovery used an isolated HOME and a PATH that could not see the host CLIs.

## Missing binaries

```json
[{"id":"claude","state":"install","version":null},{"id":"codex","state":"install","version":null}]
```

exit=0

## Present but signed out (fake binaries)

```json
[{"id":"claude","state":"signin","version":null},{"id":"codex","state":"signin","version":"0.167.2"}]
```

exit=0

## Present and ready (fake binaries, no live login)

```json
[{"id":"claude","state":"ready","version":null},{"id":"codex","state":"ready","version":"0.167.2"}]
```

exit=0
