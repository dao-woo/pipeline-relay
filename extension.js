// Pipeline Relay v0.1.0
// Watches .relay/*.relay trigger files and dispatches their contents to a new or existing Antigravity chat
// Claims triggers as .inflight; deletes on success, renames to .crash on failure

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

let paused = true;
let statusBar;
let scanning = false;
let rescanNeeded = false;
let outputChannel;

const RELAY_DIR = '.relay';
const LOG_DIR = '.logs';
const LOG_FILE = 'relay.jsonl';

function log(msg) {
    console.log(`[Relay] ${msg}`);
    if (outputChannel) outputChannel.appendLine(`[${new Date().toISOString()}] ${msg}`);
}

function logError(msg) {
    console.error(`[Relay] ${msg}`);
    if (outputChannel) outputChannel.appendLine(`[${new Date().toISOString()}] ERROR: ${msg}`);
}

function appendLog(workspaceRoot, entry) {
    const config = getConfig();
    if (!config.writeJsonLog) return;

    try {
        const logPath = path.join(workspaceRoot, RELAY_DIR, LOG_DIR, LOG_FILE);
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err) {
        logError(`JSONL write failed: ${err.message}`);
    }
}

function getConfig() {
    const cfg = vscode.workspace.getConfiguration('pipelineRelay');
    return {
        startPaused: cfg.get('startPaused', true),
        afterNewChatDelay: cfg.get('afterNewChatDelay', 2000),
        afterSendDelay: cfg.get('afterSendDelay', 2000),
        writeJsonLog: cfg.get('writeJsonLog', true),
    };
}

function activate(context) {
    // Workspace Trust gate
    if (!vscode.workspace.isTrusted) {
        console.log('[Relay] Untrusted workspace - not activating.');
        return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;

    outputChannel = vscode.window.createOutputChannel('Pipeline Relay');
    context.subscriptions.push(outputChannel);

    const config = getConfig();
    paused = config.startPaused;
    const relayPath = path.join(workspaceRoot, RELAY_DIR);

    try {
        fs.mkdirSync(relayPath, { recursive: true });
    } catch (err) {
        logError(`Cannot create ${RELAY_DIR}/: ${err.message}`);
        return;
    }

    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.command = 'pipelineRelay.toggle';
    context.subscriptions.push(statusBar);
    updateStatusBar();

    context.subscriptions.push(
        vscode.commands.registerCommand('pipelineRelay.toggle', () => {
            paused = !paused;
            updateStatusBar();
            log(paused ? 'Paused' : 'Resumed');
            if (!paused) scanRelay(workspaceRoot);
        })
    );

    const watcher = createWatcher(workspaceRoot);
    context.subscriptions.push({ dispose() { watcher.dispose(); } });

    // Scan existing triggers when activation starts unpaused
    if (!paused) scanRelay(workspaceRoot);

    log(`v0.1.0 activated (${paused ? 'paused' : 'watching'}). Watching: ${RELAY_DIR}/*.relay`);
}

function createWatcher(workspaceRoot) {
    const pattern = new vscode.RelativePattern(workspaceRoot, `${RELAY_DIR}/*.relay`);
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidCreate(() => setTimeout(() => scanRelay(workspaceRoot), 500));
    watcher.onDidChange(() => setTimeout(() => scanRelay(workspaceRoot), 500));
    return watcher;
}

async function scanRelay(workspaceRoot) {
    if (paused) return;
    if (scanning) {
        rescanNeeded = true;
        return;
    }

    scanning = true;
    try {
        do {
            rescanNeeded = false;

            const scanPath = path.join(workspaceRoot, RELAY_DIR);
            if (!fs.existsSync(scanPath)) return;

            const files = fs.readdirSync(scanPath)
                .filter(f => f.endsWith('.relay'))
                .map(f => {
                    try { return { name: f, mtime: fs.statSync(path.join(scanPath, f)).mtimeMs }; }
                    catch { return null; }
                })
                .filter(Boolean)
                .sort((a, b) => a.mtime - b.mtime); // FIFO by modification time

            for (const file of files) {
                if (paused) return;
                try {
                    await handleTrigger(path.join(scanPath, file.name), workspaceRoot);
                } catch (err) {
                    logError(`Dispatch error: ${err.message}`);
                }
            }
        } while (rescanNeeded && !paused);
    } finally {
        scanning = false;
    }
}

const MAX_RETRIES = 3;

async function retryCommand(commandId, args, retries) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await vscode.commands.executeCommand(commandId, ...args);
            return true;
        } catch (err) {
            logError(`${commandId} attempt ${attempt}/${retries} failed: ${err.message}`);
            if (attempt === retries) return false;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    return false;
}

async function handleTrigger(filePath, workspaceRoot) {
    const config = getConfig();
    const fileName = path.basename(filePath);
    const inflightPath = filePath + '.inflight';

    // Zero-byte files may still be being written; onDidChange will rescan
    try {
        if (fs.statSync(filePath).size === 0) return;
    } catch (e) {
        if (e.code === 'ENOENT') return;
        logError(`statSync error: ${fileName} - ${e.message}`);
        return;
    }

    // Atomically claim the trigger
    try {
        fs.renameSync(filePath, inflightPath);
    } catch (e) {
        if (e.code === 'ENOENT') return; // already claimed
        logError(`Rename error: ${fileName} - ${e.message}`);
        return;
    }

    const prompt = fs.readFileSync(inflightPath, 'utf-8');
    if (!prompt.trim()) {
        fs.unlinkSync(inflightPath);
        return;
    }

    const isFollowup = fileName.startsWith('followup-');
    const triggerType = isFollowup ? 'followup' : 'dispatch';
    const promptPreview = prompt.length > 120 ? prompt.substring(0, 120) + '...' : prompt;
    log(`${isFollowup ? 'Followup' : 'Dispatch'}: ${fileName} (${prompt.length} chars)`);
    log(`  Preview: ${promptPreview.replace(/\n/g, ' ')}`);

    // Dispatch opens a new chat; followup uses the active chat
    if (!isFollowup) {
        if (!await retryCommand('antigravity.startNewConversation', [], MAX_RETRIES)) {
            const crashPath = filePath + '.crash';
            fs.renameSync(inflightPath, crashPath);
            logError(`CRASH (startNewConversation): ${fileName} -> ${path.basename(crashPath)}`);
            appendLog(workspaceRoot, { ts: new Date().toISOString(), status: 'crash', file: fileName, type: triggerType, error: 'startNewConversation failed after retries', prompt });
            return;
        }
        await new Promise(r => setTimeout(r, config.afterNewChatDelay));
    }

    if (!await retryCommand('antigravity.sendPromptToAgentPanel', [prompt], MAX_RETRIES)) {
        const crashPath = filePath + '.crash';
        fs.renameSync(inflightPath, crashPath);
        logError(`CRASH (sendPromptToAgentPanel): ${fileName} -> ${path.basename(crashPath)}`);
        appendLog(workspaceRoot, { ts: new Date().toISOString(), status: 'crash', file: fileName, type: triggerType, error: 'sendPromptToAgentPanel failed after retries', prompt });
        return;
    }
    await new Promise(r => setTimeout(r, config.afterSendDelay));

    fs.unlinkSync(inflightPath);
    appendLog(workspaceRoot, { ts: new Date().toISOString(), status: 'ok', file: fileName, type: triggerType, prompt });
    log(`Done: ${fileName}`);
}

function updateStatusBar() {
    if (!statusBar) return;
    if (paused) {
        statusBar.text = '$(debug-pause) Relay';
        statusBar.tooltip = 'Pipeline Relay: paused. Click to resume.';
        statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
        statusBar.text = '$(zap) Relay';
        statusBar.tooltip = 'Pipeline Relay: watching for trigger files.';
        statusBar.backgroundColor = undefined;
    }
    statusBar.show();
}

function deactivate() {
    log('Deactivated.');
}

module.exports = { activate, deactivate };
