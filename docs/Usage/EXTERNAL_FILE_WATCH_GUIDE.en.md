# External File Change Watch — User Guide

> Applies to flymd v0.x (PR-1 + PR-1.1 + PR-2 and later)
> 中文版:see [`EXTERNAL_FILE_WATCH_GUIDE.md`](./EXTERNAL_FILE_WATCH_GUIDE.md)

## Overview

flymd **automatically watches** the file of the currently active tab for external modifications. When another program (editor, IDE, cloud-sync client, git hook, etc.) writes to the file, flymd reacts based on whether your current tab has unsaved changes — so you never lose local edits, but you also never miss an external update.

> Scope: only the **currently active tab** is monitored. External changes to background tabs are intentionally ignored to avoid overwriting edits the user cannot see.

## Behavior

| Current tab state | On external change |
|---|---|
| **Clean** (no unsaved edits) | Automatically overwrite with disk content; toast: "External change detected, reloaded automatically" |
| **Dirty** (has unsaved edits) | Show a 3-choice modal so you can decide |
| **File deleted / inaccessible** | Show "File was deleted or became inaccessible, tab detached"; the tab detaches from the file path |

### The 3 options in the conflict modal

1. **Cancel** — do nothing; keep your local edits. The next save will overwrite the external version.
2. **Keep local (will overwrite on save)** — do nothing. The watcher's internal snapshot is already updated; further prompts only fire if the file really changes again.
3. **Reload (discard local)** — discard your local edits and load the latest content from disk.

> Focus defaults to the **Cancel** button to prevent mis-clicks. `ESC` or clicking the overlay are also treated as Cancel.

## Preferences

**Entry point**: `File` menu → `File Watch Settings…`

Three switches:

| Switch | Default | When OFF |
|---|---|---|
| **Watch external file changes** | ✅ ON | External modifications produce no prompts and no auto-reloads (both strategy and core layers stop) |
| **Auto-reload clean tabs** | ✅ ON | Clean tabs also stop auto-reloading — you only get a notification, then decide manually |
| **Debug logging** | ❌ OFF | When ON, verbose watcher / integration logs are printed to the console (for diagnosis) |

Preferences persist in `flymd-settings.json` under the `externalFileWatch` key:

```json
{
  "externalFileWatch": {
    "enabled": true,
    "autoReloadClean": true,
    "debugLog": false
  }
}
```

> Toggling **Watch external file changes** takes effect immediately: when OFF, the watcher releases all watch handles; when ON again, it re-attaches them.

## Scope & Limitations

1. **Only the active tab** — events on background tabs are ignored. When you switch to a background tab, a stat re-check is performed; if it has changed, the full strategy runs.
2. **PDF files are not watched** — PDFs are managed by the built-in reader (via the `isSkippablePath` rule matching `.pdf`).
3. **Cloud sync clients** (iCloud / OneDrive / Dropbox):
   - The **final** write after a sync is detected normally.
   - Mid-sync intermediate states (rename + write) are covered by a 2-stage stat retry (400ms).
   - Occasional double-fires may still happen, but the second is dropped because the snapshot has not changed.
4. **Large files** — currently only mtime + size are compared (optional ≤1MB hash is planned for PR-3, not enabled in this release).
5. **After save** — `saveFile` / `saveAs` use a 2-second suppression window plus a snapshot refresh, so self-write events are not mistaken for external changes.
6. **Turning the master switch off** — completely stops watching (both layers). No app restart required.

## Troubleshooting

### Q1: I edit the file externally, flymd does nothing

Check in order:

1. Is the **master switch** off? `File` → `File Watch Settings…` → confirm "Watch external file changes" is ON.
2. Is the file you modified the one in the **active tab**? Background tabs are ignored.
3. Is the file a **PDF**? PDFs are not watched.
4. Turn on **Debug logging**, then check the console for `[openFileWatcher]` lines:
   - No log at all → watcher did not start. Could be a browser/downgraded environment, or `watchPathsAbs` failed.
   - Log present but no `[modified]` event → file path mismatch (normalization issue).
   - `[suppress]` log appears → hit the 2s suppression window (likely a self-write loop).

### Q2: After auto-reload, the content is wrong or marked as modified

1. Confirm **Auto-reload clean tabs** is ON.
2. Turn on **Debug logging** and inspect `[openFileWatcher] event handler` / `[openFileWatcher] checkChange` entries.
3. If you are in **WYSIWYG** mode, check that the YAML Front Matter is preserved (fixed in PR-1.1, commit 371997b).

### Q3: After switching to a background tab, the content is not updated

Background-tab events are ignored; switching back performs an automatic **stat re-check**. If that does not fire:
- The tab may be a draft (no `filePath`).
- `watchPathsAbs` failed for that parent directory — check **Debug logging**.

### Q4: Right after a save, the file is detected as externally modified and prompts me

This was a known **self-loop** issue, fixed in PR-1. If you still see it:
- With **Debug logging** ON you should see `[openFileWatcher] 抑制自循环事件`.
- If not → the suppression window is not working, or `watchPathsAbs` did not fire within the 2s window.
- Known edge case: a **third-party** modification within 2s after your save is also suppressed (by design, to prevent write races).

## Implementation (for developers)

```
┌─────────────────────┐    ┌──────────────────────────────┐
│ src/core/           │    │ src/core/                    │
│ openFileWatcher.ts  │    │ openFileWatcherIntegration.ts│
│ (core layer)        │    │ (strategy layer)             │
│                     │    │                              │
│ - watchPathsAbs     │◀───│ - deps.enabled (prefs)       │
│ - 2s suppression    │    │ - clean tab: auto-reload     │
│ - 2-stage stat      │    │ - dirty tab: conflict modal  │
│ - snapshot compare  │    │ - file missing: detach tab   │
└─────────────────────┘    └──────────────────────────────┘
                                    ▲
                                    │ deps injection
                                    │
                          ┌─────────────────────┐
                          │ src/main.ts         │
                          │ - wire integration  │
                          │ - showFileWatch     │
                          │   ConflictDialog    │
                          │ - showFileWatch     │
                          │   PrefsDialog       │
                          └─────────────────────┘
```

- The core layer **has no** UI / business dependencies and downgrades to a no-op in browser / test environments.
- The strategy layer **does not** depend on the core layer internals, only the `OpenFileWatcher` interface.
- `main.ts` is the **only** wiring point; it injects store, notification manager, and i18n.

## Feedback

If you find a bug or have a suggestion, please open an issue and include:

- flymd version (visible on the About page)
- Reproduction steps (which file / which tool modified it / expected vs. actual)
- Relevant console output with **Debug logging** enabled
