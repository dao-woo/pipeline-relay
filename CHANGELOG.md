# Changelog

## 0.1.4

- Added `pipelineRelay.dispatchDelay` (default `0`): delay (ms) after a trigger is claimed and before a new chat is created. Does not apply to followup triggers.
- README: scoped the missing-automation claim to the Antigravity IDE, removed the obsolescence prediction, and described the trigger file as an open dispatch interface.

## 0.1.3

- Refactored the VS Code entrypoint into a synchronous composition root.
- Moved the Relay core into `src/core/index.js`.
- No dispatch behavior changes.

## 0.1.2

- Updated README.

## 0.1.1

Maintenance update:

- Added a one-minute timelapse demo to the README.
- Clarified documented limitations.
- Changed Output and JSONL timestamps to use the extension host's local date/time format.
