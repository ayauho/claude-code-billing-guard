// Breaker 0.1 — Claude Code Billing Guard
//
// Watches for the moment Claude Code stops billing your Pro/Max subscription
// and starts billing your API key instead, and warns you immediately.
//
// Design constraints (deliberate, see pitch deck for rationale):
//   - Zero network calls. Zero telemetry. Zero external dependencies at runtime.
//   - Fails SILENT, never fails LOUD: if a signal can't be read or doesn't match
//     a known shape, we treat it as UNKNOWN and do not alarm. A false "all clear"
//     is annoying; a false alarm destroys trust in the tool on day one.
//   - Never auto-executes shell commands on the user's behalf. The "fix" action
//     opens clear instructions and a terminal — it doesn't run anything for you.

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE = { SUBSCRIPTION: 'SUBSCRIPTION', API: 'API', UNKNOWN: 'UNKNOWN' };

let statusBarItem;
let pollTimer;
let currentState = STATE.UNKNOWN;

function candidateCredentialPaths() {
  const home = os.homedir();
  const override = vscode.workspace.getConfiguration('breaker').get('credentialPath');
  const candidates = [];
  if (override && override.trim().length > 0) candidates.push(override.trim());

  // Best-effort guesses based on the research that fed this extension's spec.
  // UNVERIFIED against every installed version — this is exactly why the parser
  // below is defensive and falls back to the env-var signal when uncertain.
  candidates.push(path.join(home, '.claude', 'credentials', 'default.json'));
  candidates.push(path.join(home, '.config', 'claude-code', 'credentials', 'default.json'));
  if (process.platform === 'win32' && process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'claude', 'credentials', 'default.json'));
  }
  return candidates;
}

function readCredentialSignal() {
  for (const p of candidateCredentialPaths()) {
    try {
      if (!fs.existsSync(p)) {
        continue;
      }
      const raw = fs.readFileSync(p, 'utf8');
      const json = JSON.parse(raw);

      // Defensive, multi-key lookup — we don't know the exact schema for certain,
      // so we check several plausible field names rather than assuming one.
      const loginMethod = json.loginMethod || json.login_method || json.authMethod || json.auth_method;
      if (typeof loginMethod === 'string') {
        const lower = loginMethod.toLowerCase();
        if (lower.includes('claudeai') || lower.includes('subscription') || lower.includes('pro') || lower.includes('max')) {
          return STATE.SUBSCRIPTION;
        }
        if (lower.includes('api')) {
          return STATE.API;
        }
      }
    } catch (e) {
      continue;
    }
  }
  return null; // no usable signal from any candidate file
}

function readEnvSignal() {
  // This is the documented, reliable trigger from every GitHub issue this
  // tool is built around: if either of these is set, Claude Code will route
  // to pay-per-token API billing.
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    return STATE.API;
  }
  return null;
}

function computeState() {
  const credentialSignal = readCredentialSignal();
  const envSignal = readEnvSignal();

  // If either signal says API, trust it — that's the expensive direction to
  // get wrong, and both signals independently point at real trigger conditions.
  if (credentialSignal === STATE.API || envSignal === STATE.API) return STATE.API;
  if (credentialSignal === STATE.SUBSCRIPTION) return STATE.SUBSCRIPTION;

  // No env key set and no readable credential file confirming subscription
  // mode — rather than assume, stay UNKNOWN and stay quiet.
  return STATE.UNKNOWN;
}

function renderStatusBar(state) {
  if (!statusBarItem) return;
  if (state === STATE.SUBSCRIPTION) {
    statusBarItem.text = '$(pass-filled) Breaker: Subscription';
    statusBarItem.backgroundColor = undefined;
    statusBarItem.color = new vscode.ThemeColor('charts.green');
    statusBarItem.tooltip = 'Claude Code is billing your subscription. Click for details.';
  } else if (state === STATE.API) {
    statusBarItem.text = '$(alert) Breaker: API BILLING';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    statusBarItem.color = undefined;
    statusBarItem.tooltip = 'Claude Code appears to be billing your API key, not your subscription. Click to fix.';
  } else {
    statusBarItem.text = '$(question) Breaker: Unknown';
    statusBarItem.backgroundColor = undefined;
    statusBarItem.color = undefined;
    statusBarItem.tooltip = "Couldn't determine billing mode confidently. Not alarming on an unclear signal.";
  }
  statusBarItem.show();
}

async function checkAndUpdate() {
  const next = computeState();
  const transitionedToApi = next === STATE.API && currentState !== STATE.API;
  currentState = next;
  renderStatusBar(currentState);

  if (transitionedToApi) {
    const choice = await vscode.window.showWarningMessage(
      "Breaker: Claude Code just switched to API billing instead of your subscription. You're now paying per token.",
      'Restore subscription mode',
      'Dismiss'
    );
    if (choice === 'Restore subscription mode') {
      vscode.commands.executeCommand('breaker.restoreSubscription');
    }
  }
}

function showStatus() {
  const messages = {
    [STATE.SUBSCRIPTION]: 'Breaker: Claude Code is currently billing your subscription. You\u2019re clear.',
    [STATE.API]: 'Breaker: Claude Code is currently billing your API key, not your subscription.',
    [STATE.UNKNOWN]: 'Breaker: Billing mode is unclear from the signals available on this machine. No alarm is firing, by design \u2014 see breaker.credentialPath in settings if you want to help it detect more reliably.'
  };
  vscode.window.showInformationMessage(messages[currentState]);
}

async function restoreSubscription() {
  // No terminal injection — comment lines still get recorded in shell history
  // even when they're no-ops, which is exactly the kind of footprint this
  // tool shouldn't leave. Read-only instructions belong in a document, not
  // typed into a live shell session.
  const content = [
    'Breaker — suggested next steps',
    '(review and run these yourself in a terminal if you want to — nothing here runs automatically)',
    '',
    '1. unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN',
    '2. restart your Claude Code session',
    "3. if it still shows API billing, try: claude  then run /login from inside it"
  ].join('\n');

  const doc = await vscode.workspace.openTextDocument({ content, language: 'plaintext' });
  await vscode.window.showTextDocument(doc, { preview: true });
}

function activate(context) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'breaker.showStatus';
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('breaker.showStatus', showStatus),
    vscode.commands.registerCommand('breaker.restoreSubscription', restoreSubscription)
  );

  checkAndUpdate();
  const intervalMs = vscode.workspace.getConfiguration('breaker').get('pollIntervalMs') || 15000;
  pollTimer = setInterval(checkAndUpdate, intervalMs);
  context.subscriptions.push({ dispose: () => clearInterval(pollTimer) });
}

function deactivate() {
  if (pollTimer) clearInterval(pollTimer);
}

module.exports = { activate, deactivate };