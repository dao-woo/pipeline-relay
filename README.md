# Pipeline Relay

An Antigravity IDE extension that lets AI agents launch other agents.

**Antigravity currently has no command line, API, or automation features.** This extension works around that limitation in an unusual way: any agent capable of creating files in the workspace can start a new chat in Antigravity or send a message to the current one.

No private APIs. No network calls. No dependencies. ~240 lines of code.

## Demo

[![Pipeline Relay one-minute timelapse demo](https://img.youtube.com/vi/LbA1JFgAcFM/hqdefault.jpg)](https://youtu.be/LbA1JFgAcFM)

A one-minute timelapse of a 2+ hour Pipeline Relay run: 181 Antigravity agents working through an OCR workflow via file-based `.relay` triggers.

## Quick Start

Restart Antigravity after installation and click **⏸ Relay** in the status bar to unpause. The extension starts paused by default.

Try asking your agent to read [this README](https://github.com/dao-woo/pipeline-relay#readme), explain what Pipeline Relay lets it do, and show you a simple demo.

A few lines about `.relay` triggers in your workspace rules are enough for a basic start. Reliable workflows require more deliberate design — see [Design, Not Infrastructure](#design-not-infrastructure).

## Features

**Antigravity agents, just like third-party agents, can create other Antigravity agents.**

### How It Works

The extension watches the `.relay/` directory at the root of the first open workspace folder. The directory is created automatically on activation.
When a new `*.relay` file appears, the extension reads the file content as a prompt, creates a new Antigravity conversation, and sends the prompt into it. Files prefixed with `followup-` skip new chat creation and send the prompt directly to the **current active conversation**.

**Any agent that can write a file can trigger an Antigravity conversation:**

Ask the agent to create a trigger file:

```text
Use `write_to_file` to create `.relay/name.relay` with this prompt: "..."
```

The file watching module responds to new events with a delay of 500 ms.

The extension doesn't care who writes the file. It reads the content, dispatches the prompt, and deletes the trigger. The trust boundary is the filesystem itself — see Security.

### Dispatch Patterns

#### Relay chain

Each agent writes the next trigger as its last step. Sequential pipeline — A finishes, then B starts.
```
Agent A → .relay/step-2.relay → Agent B → .relay/step-3.relay → Agent C
```

#### Fan-out

Create multiple triggers at once. Conversations start independently.
```
Agent → .relay/review.relay  → Agent 1
      → .relay/tests.relay   → Agent 2
      → .relay/docs.relay    → Agent 3
```

#### Hybrid

Combine both: fan-out, then each branch chains further.
```
Orchestrator → .relay/frontend.relay → Agent 1 → .relay/fe-tests.relay → Agent 4
             → .relay/backend.relay  → Agent 2 → .relay/be-tests.relay → Agent 5
             → .relay/infra.relay    → Agent 3
```

### Design, Not Infrastructure

**Pipeline Relay is not an orchestration runtime. It is a tiny file-based dispatch layer.**

Its purpose is to make agent orchestration accessible through ordinary workspace artifacts: trigger files, prompts, and natural-language instructions.

Robust workflows depend on how you structure workspace state, prompts, and delegation:

- Minimize uncertainty — the main context should be determined by the workspace itself.
- Reduce cognitive load — keep each agent's task small and bounded.
- Design workflow logic — continuation and completion depend on agent decisions embedded in prompts and workspace context.

## Reference

### File Format

- **Name:** `*.relay` — new-chat dispatch; `followup-*.relay` — followup (non-addressable)
- **Content:** plain text prompt
- Processed FIFO by modification time
- Claimed as `.inflight` during processing
- Deleted on success, renamed to `.crash` if an Antigravity command fails

### Manual installation

Clone the repo and copy the extension folder into your Antigravity `extensions/` directory, or download the `.vsix` from [Releases](https://github.com/dao-woo/pipeline-relay/releases).

### Dispatch Log

When `pipelineRelay.writeJsonLog` is enabled, each successful or failed dispatch is recorded to `.relay/.logs/relay.jsonl` — one JSON line per event. The log lives in a hidden directory so it doesn't distract agents working with trigger files.
```json
{"ts":"4/15/2026, 12:00:00 PM","status":"ok","file":"review.relay","type":"dispatch","prompt":"..."}
{"ts":"4/15/2026, 12:00:05 PM","status":"crash","file":"tests.relay","type":"dispatch","error":"startNewConversation failed after retries","prompt":"..."}
```
Timestamps use the extension host's local date/time format. The file contains full prompt contents and grows indefinitely. Set `pipelineRelay.writeJsonLog` to `false` to disable it, or delete the file manually when no longer needed.

### Controls

- **Status bar:** click to toggle pause/resume
- **Command palette:** `Pipeline Relay: Toggle Pause/Resume`
- By default the extension starts **paused** — click to begin watching

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `pipelineRelay.startPaused` | `true` | Start paused on activation. Set to `false` to begin watching immediately |
| `pipelineRelay.afterNewChatDelay` | `2000` | Delay (ms) after creating a new chat before sending the prompt |
| `pipelineRelay.afterSendDelay` | `2000` | Delay (ms) after sending the prompt before processing the next trigger |
| `pipelineRelay.writeJsonLog` | `true` | Write full-prompt JSONL dispatch events to `.relay/.logs/relay.jsonl` |

Tip: Increase `pipelineRelay.afterSendDelay` if Antigravity needs more time between dispatches.

### Behavior Notes

- The extension watches only `.relay/*.relay` in the first open workspace folder; nested directories are ignored.
- If no workspace folder is open, or the workspace is untrusted, relay behavior does not activate.
- Trigger files are processed sequentially, oldest first. Files created while paused are processed when you resume.
- Zero-byte files are skipped until they are modified. Whitespace-only files are claimed and deleted without opening a chat.
- Default dispatch triggers open a new Antigravity chat; `followup-*` triggers send to the current active chat.
- Antigravity commands are tried up to 3 times, with a 1 second delay between attempts.
- `pipelineRelay.startPaused` is applied on activation. Delay settings are read for each trigger.
- `pipelineRelay.writeJsonLog` is read for each JSONL log write.
- The Pipeline Relay output channel always logs live status and a prompt preview, up to the first 120 characters.
- There is no trigger limit. Concurrency control is the orchestrator's responsibility.

## Architecture and Security

### Under the Hood

The extension uses the standard VS Code extension API (`vscode.commands.executeCommand`) to call two commands published by the Antigravity extension:
- `antigravity.startNewConversation`
- `antigravity.sendPromptToAgentPanel`

Official API or CLI support in Antigravity may make this extension obsolete. Whether this file-based mechanism still has value will depend on what native automation actually provides.

### Limitations

- There is no auto-approval.
  - The continuity of the workflow depends on the environment settings and prompts.
- There is no workflow auto-replay.
  - It’s easy to pick up where you left off.
  - If the agent couldn't write the next trigger, that's a sign of cognitive overload — review the workflow.
- Addressable followup is not possible with the available commands.
  - The current implementation of followup is primarily intended for use with third-party agents.
- Model selection is not supported.
  - The available Antigravity commands do not expose a way to choose the model for a new conversation.

### Security

The extension requires [Workspace Trust](https://code.visualstudio.com/docs/editor/workspace-trust). In an untrusted workspace, it will not activate at all.

The reason is simple: the extension does not verify the source of `.relay` files. It reads any file with the corresponding extension and sends its content as an AI prompt. This makes the `.relay/` directory a prompt injection vector — any process or cloned repository that can write a file there can trigger an AI conversation with arbitrary instructions.
The user running the extension in their workspace must take full responsibility for its security. Any skill, dependency, or generated file can exploit this vector.

## Meta

### Disclaimer

This is an **unofficial, independent experiment**. It is not affiliated with, endorsed by, or supported by Google or the Antigravity team.
That said:

- **It may break at any time.** Antigravity updates can rename, remove, or change the behavior of the commands this extension depends on. There are no stability guarantees.

Use at your own risk. Experiment, have fun, but don't rely on this for anything critical.

### AI provenance

This release was designed, implemented, debugged, and tested through AI-assisted development. The maintainer is not a professional programmer and did not hand-write the source code. The extension has been tested through practical use, but it has not received an expert human code review.

### Contributing

This is a personal experiment, maintained on a best-effort basis. The released extension intentionally keeps the core small and transparent. Further development is possible, but not guaranteed.

Human code review is welcome, especially reports that identify concrete risks, bugs, or security issues. Please open an issue first.

I may not be able to review or support major code contributions, so please feel free to fork the project and experiment with new features.

### Personal experience

Thanks to this extension, I can now run complex workflows that can last for hours and involve hundreds of agents—without writing any code, without complex abstractions, using only natural language.

Behind the simplicity of file-based dispatch lies a deeper challenge: how to get agents to do what you want without external dependencies.

Using this extension has given me a better understanding of how AI agents work and has significantly changed my perspective on orchestration. And perhaps this topic deserves its own, more detailed discussion.

Please share your experiences, impressions, and opinions in [Discussions](https://github.com/dao-woo/pipeline-relay/discussions). I'm curious to see how far this might go.

### Author

[dao-woo](https://github.com/dao-woo)

### License

[MIT](LICENSE)
