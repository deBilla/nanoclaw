---
name: add-gdrive-tool
description: Add Google Drive as an MCP tool (files, Docs, Sheets, Slides, search, share, upload/download) using OneCLI-managed OAuth. The agent gets Drive tools in every enabled group; OneCLI injects real tokens at request time so no raw credentials are ever in the container or on disk in usable form.
---

# Add Google Drive Tool (OneCLI-native)

This skill wires [`@piotr-agier/google-drive-mcp`](https://www.npmjs.com/package/@piotr-agier/google-drive-mcp) into selected agent groups. The MCP server reads stub credentials containing the `onecli-managed` placeholder; the OneCLI gateway intercepts outbound calls to `*.googleapis.com` and swaps the bearer for the real OAuth token from its vault.

**Why this package:** Supports the full Google Workspace surface — Drive file management, Google Docs (surgical text edits, tables, images, comments), Google Sheets (read/write, formatting, data validation), Google Slides (shapes, reorder, speaker notes), Shared Drives, permissions, revisions, and an optional Calendar overlay. Actively maintained, MIT licensed.

Tools exposed (surfaced as `mcp__drive__<name>`): `search`, `listFolder`, `listSharedDrives`, `listGoogleDocs`, `listGoogleSheets`, `createFolder`, `createTextFile`, `createGoogleDoc`, `createGoogleSheet`, `createGoogleSlides`, `getGoogleDocContent`, `readGoogleDoc`, `updateGoogleDoc`, `getGoogleSheetContent`, `updateGoogleSheet`, `appendSpreadsheetRows`, `getGoogleSlidesContent`, `updateGoogleSlides`, `uploadFile`, `downloadFile`, `copyFile`, `moveItem`, `renameItem`, `deleteItem`, `shareFile`, `addPermission`, `removePermission`, `listPermissions`, `lockFile`, `unlockFile`, `getRevisions`, `restoreRevision`, `addComment`, `listComments`, `replyToComment`, `deleteComment`, `getDocumentInfo`, `getSpreadsheetInfo`, `addSheet`, `deleteSheet`, `renameSheet`, `createShortcut`, `authGetStatus`, `authListScopes`, and more. Run `tools/list` against the MCP server to enumerate the full set.

**Optional Calendar overlay:** The package also exposes `listCalendars`, `createCalendarEvent`, `updateCalendarEvent`, `deleteCalendarEvent`, `getCalendarEvent`, `getCalendarEvents`. These require `calendar.events` scope at OAuth connect time (see Phase 1). If you already have `/add-gcal-tool` installed, these are redundant — omit the calendar scopes to keep them disabled.

**Why this pattern:** v2's invariant is that containers never receive raw API keys (CHANGELOG 2.0.0). Same stub-file pattern `/add-gmail-tool` and `/add-gcal-tool` use. Installs independently and removes cleanly.

## Phase 1: Pre-flight

### Verify OneCLI has Google Drive connected

```bash
onecli apps get --provider google-drive
```

Expected: `"connection": { "status": "connected" }` with scopes including `drive` and `documents`.

If not connected, tell the user:

> Open the OneCLI web UI at http://127.0.0.1:10254, go to Apps → Google Drive, and click Connect. Sign in with the Google account the agent should act as.
>
> Minimum useful scopes: `drive`, `documents`, `spreadsheets`, `presentations`.
> Add `calendar.events` only if you want the Calendar overlay tools AND don't already have `/add-gcal-tool`.

### Verify stub credentials exist

```bash
ls -la ~/.gdrive-mcp/gcp-oauth.keys.json ~/.gdrive-mcp/credentials.json 2>&1
```

If both exist and contain `onecli-managed`:

```bash
grep -l onecli-managed ~/.gdrive-mcp/gcp-oauth.keys.json ~/.gdrive-mcp/credentials.json
```

...skip to Phase 2.

If either file exists but does **not** contain `onecli-managed`, **STOP** — these are real OAuth credentials from a previous non-OneCLI install. Back them up, then delete before proceeding.

If both files are absent, write them now:

```bash
mkdir -p ~/.gdrive-mcp
cat > ~/.gdrive-mcp/gcp-oauth.keys.json <<'EOF'
{
  "installed": {
    "client_id": "onecli-managed.apps.googleusercontent.com",
    "client_secret": "onecli-managed",
    "redirect_uris": ["http://localhost:3000/oauth2callback"]
  }
}
EOF
cat > ~/.gdrive-mcp/credentials.json <<'EOF'
{
  "access_token": "onecli-managed",
  "refresh_token": "onecli-managed",
  "token_type": "Bearer",
  "expiry_date": 99999999999999,
  "scope": "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/presentations"
}
EOF
chmod 600 ~/.gdrive-mcp/gcp-oauth.keys.json ~/.gdrive-mcp/credentials.json
```

If you want the Calendar overlay tools, add `https://www.googleapis.com/auth/calendar.events` to the `scope` value in `credentials.json`.

### Verify mount allowlist covers the path

```bash
cat ~/.config/nanoclaw/mount-allowlist.json
```

`~/.gdrive-mcp` must sit under an `allowedRoots` entry (e.g. your home directory). If it doesn't, tell the user to run `/manage-mounts` first or add their home directory.

### Check agent secret-mode

For each target agent group, confirm OneCLI will inject the Google Drive token:

```bash
onecli agents list
```

If that agent's `secretMode` is `all`, you're done. If it's `selective`, explicitly assign the Drive secret:

```bash
onecli secrets list     # find the Google Drive secret ID
onecli agents set-secrets --id <agent-id> --secret-ids <gdrive-secret-id>
```

## Phase 2: Apply Code Changes

### Check if already applied

```bash
grep -q 'GDRIVE_MCP_VERSION' container/Dockerfile && \
grep -q "mcp__drive__\*" container/agent-runner/src/providers/claude.ts && \
echo "ALREADY APPLIED — skip to Phase 3"
```

### Add MCP server to Dockerfile

Edit `container/Dockerfile`. Find the pinned-version ARG block:

```dockerfile
ARG CLAUDE_CODE_VERSION=2.1.116
ARG AGENT_BROWSER_VERSION=latest
ARG VERCEL_VERSION=latest
ARG BUN_VERSION=1.3.12
ARG GMAIL_MCP_VERSION=1.1.11
```

Add a new line:

```dockerfile
ARG GDRIVE_MCP_VERSION=2.2.0
```

Then add a new `pnpm install -g` block after the existing MCP installs, before `# ---- Entrypoint`:

```dockerfile
RUN --mount=type=cache,target=/root/.cache/pnpm \
    pnpm install -g "@piotr-agier/google-drive-mcp@${GDRIVE_MCP_VERSION}"
```

**No zod pin needed:** `@piotr-agier/google-drive-mcp@2.2.0` depends on `zod: ^3.25.76` directly. It does not use `zod-to-json-schema`, so there is no subpath import conflict (unlike the Gmail MCP — see `/add-gmail-tool` notes). Re-check if you bump `GDRIVE_MCP_VERSION`.

### Add tools to allowlist

Edit `container/agent-runner/src/providers/claude.ts`. Find `'mcp__nanoclaw__*',` in `TOOL_ALLOWLIST` and add `'mcp__drive__*',` after it (or after `'mcp__gmail__*'` / `'mcp__calendar__*'` if already present).

### Rebuild the container image

```bash
./container/build.sh
```

Must complete cleanly. The new pnpm layer takes ~30s first time (cached on rebuild).

## Phase 3: Wire Per-Agent-Group

For each agent group that should have Drive access, edit `groups/<folder>/container.json` to add the mount and MCP server.

Merge these into the group's `container.json`:

```jsonc
{
  "mcpServers": {
    "drive": {
      "command": "google-drive-mcp",
      "args": [],
      "env": {
        "GOOGLE_DRIVE_OAUTH_CREDENTIALS": "/workspace/extra/.gdrive-mcp/gcp-oauth.keys.json",
        "GOOGLE_DRIVE_MCP_TOKEN_PATH": "/workspace/extra/.gdrive-mcp/credentials.json"
      }
    }
  },
  "additionalMounts": [
    {
      "hostPath": "/home/<user>/.gdrive-mcp",
      "containerPath": ".gdrive-mcp",
      "readonly": false
    }
  ]
}
```

Substitute `<user>` with the actual home path from `echo $HOME` — don't assume `~` will expand (an explicit absolute path is clearer and matches what `/manage-mounts` writes).

**Why the container path is relative:** `mount-security` rejects absolute `containerPath` values. Additional mounts are prefixed with `/workspace/extra/`, so `containerPath: ".gdrive-mcp"` lands at `/workspace/extra/.gdrive-mcp`. The env vars point at that absolute path inside the container.

**Co-existing with Gmail and Calendar:** if this group already has `gmail` and/or `calendar` MCP servers, **merge, don't replace** — all three entries coexist in `mcpServers` and `additionalMounts`.

## Phase 4: Build and Restart

```bash
pnpm run build
systemctl --user restart nanoclaw   # Linux
# launchctl kickstart -k gui/$(id -u)/com.nanoclaw   # macOS
```

Kill any existing agent containers so they respawn with the updated mcpServers config:

```bash
docker ps -q --filter 'name=nanoclaw-v2-' | xargs -r docker kill
```

## Phase 5: Verify

### Test from a wired agent

> Send: **"list my Google Drive root folder"** or **"search Drive for any spreadsheets modified this week"**.
>
> The agent should use `mcp__drive__listFolder` or `mcp__drive__search`. First call takes 2–3s while the MCP server starts and OneCLI does the token exchange.

### Check logs if the tool isn't working

```bash
tail -100 logs/nanoclaw.log logs/nanoclaw.error.log | grep -iE 'drive|mcp'
# Per-container logs — session-scoped:
ls data/v2-sessions/*/stderr.log | head
```

Common signals:
- `command not found: google-drive-mcp` → image wasn't rebuilt or `$PNPM_HOME` not on PATH (should be — `ENV PATH="$PNPM_HOME:$PATH"` in Dockerfile).
- `ENOENT: no such file or directory, open '/workspace/extra/.gdrive-mcp/credentials.json'` → mount is missing. Check `~/.config/nanoclaw/mount-allowlist.json` includes a parent of `~/.gdrive-mcp`.
- `401 Unauthorized` from `*.googleapis.com` → OneCLI isn't injecting. Check the agent's secret mode (`onecli agents secrets --id <agent-id>`) and that Google Drive is connected (`onecli apps get --provider google-drive`).
- Agent says "I don't have Drive tools" → `mcp__drive__*` missing from `TOOL_ALLOWLIST`, or the image wasn't rebuilt. Run `./container/build.sh` again with `--no-cache` if suspicious.
- `authGetStatus` returns missing scopes → the OAuth connection in OneCLI was made with insufficient scopes. Disconnect and reconnect Google Drive in the web UI with the expanded scope set.

## Removal

1. Delete the `"drive"` entry from `mcpServers` and the `.gdrive-mcp` entry from `additionalMounts` in each group's `container.json`.
2. Remove `'mcp__drive__*'` from `TOOL_ALLOWLIST` in `container/agent-runner/src/providers/claude.ts`.
3. Remove the `GDRIVE_MCP_VERSION` ARG and the `pnpm install -g @piotr-agier/google-drive-mcp` block from `container/Dockerfile`.
4. `pnpm run build && ./container/build.sh && systemctl --user restart nanoclaw`.
5. (Optional) `rm -rf ~/.gdrive-mcp/` if no other host-side tool needs the stubs.
6. (Optional) Disconnect in OneCLI: `onecli apps disconnect --provider google-drive`.

## Notes

- **Stub format is OneCLI-prescribed.** Same `access_token: "onecli-managed"` + `expiry_date: 99999999999999` pattern as Gmail and Calendar. OneCLI intercepts the outgoing API call and rewrites `Authorization: Bearer onecli-managed` to the real token. The far-future expiry prevents the auth client from attempting a refresh before OneCLI can swap the token.
- **Scopes are set at OAuth connect time.** If the agent needs scopes beyond what's currently connected (e.g. `calendar.events` for the overlay tools), disconnect and reconnect Google Drive in the OneCLI web UI with the expanded scope set. No image rebuild needed — scope changes take effect on the next API call.
- **`readonly: false` on the mount.** The Drive MCP caches resolved tokens back to `credentials.json` on first use. If the mount is read-only the write fails silently and the next session has to re-exchange. Keep it writable.
- **Calendar overlap.** If `/add-gcal-tool` is also installed, the agent will have two sets of calendar tools (`mcp__drive__listCalendars` etc. and `mcp__calendar__list-calendars` etc.). Both work; they just use different MCP servers. To avoid confusion, omit the calendar scopes from the Drive OAuth connection and let the dedicated Calendar MCP handle all calendar operations.
- **Shared Drives.** `listSharedDrives` and the `driveId` parameter on search/list tools give access to Google Workspace Shared Drives. Requires the account to have access to at least one Shared Drive — no extra scope needed beyond `drive`.

## Credits & references

- **MCP server:** [`@piotr-agier/google-drive-mcp`](https://github.com/piotragier/google-drive-mcp) by Piotr Agier — MIT-licensed, actively maintained.
- **OneCLI credential stubs:** pattern documented at `https://onecli.sh/docs/guides/credential-stubs/google-drive.md`.
- **Skill pattern:** direct sibling of [`/add-gmail-tool`](../add-gmail-tool/SKILL.md) and [`/add-gcal-tool`](../add-gcal-tool/SKILL.md); same OneCLI stub mechanism.
- **Addresses:** extends the Google Workspace toolset beyond email and calendar to file and document management.
