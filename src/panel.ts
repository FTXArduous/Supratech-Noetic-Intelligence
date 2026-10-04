import * as vscode from 'vscode';

export interface PanelState {
  trace: string;
  english: string;
  verifier: string;
  summary: string;
}

export const VIEW_ID = 'sni.view';

export class SniPanel implements vscode.WebviewViewProvider {
  static readonly instance = new SniPanel();
  private view: vscode.WebviewView | undefined;
  private state: PanelState = { trace: '', english: '', verifier: '', summary: '' };

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = html();
    view.onDidDispose(() => (this.view = undefined));
    view.webview.postMessage(this.state);
  }

  static show(): SniPanel {
    const p = SniPanel.instance;
    if (p.view) p.view.show(true);
    else vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    return p;
  }

  update(patch: Partial<PanelState>) {
    this.state = { ...this.state, ...patch };
    this.view?.webview.postMessage(this.state);
  }
}

function html(): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
<style>
body{font-family:var(--vscode-font-family);padding:0 8px 8px}
#pay{position:sticky;top:0;padding:6px 0;background:var(--vscode-sideBar-background);border-bottom:1px solid var(--vscode-panel-border);font-weight:bold;z-index:1}
summary{cursor:pointer;font-weight:bold;margin:8px 0 4px}
pre{white-space:pre-wrap;margin:0}
</style></head>
<body>
<div id="pay">Cashapp :: $ArduousSpec</div>
<details open><summary>How to use SNI</summary>
<p>In Copilot Chat, send <code>@sni your prompt</code> for the default tier.</p>
<p>Choose a tier with <code>@sni /meta</code>, <code>@sni /hyper</code>, <code>@sni /empyrean</code>, or <code>@sni /anagogic</code>, followed by your prompt.</p>
<p>Requires GitHub Copilot Chat. Review the verifier and answer; verification is not a guarantee.</p>
</details>
<details open><summary>English translation</summary><pre id="english"></pre></details>
<details open><summary>Verifier (J-space)</summary><pre id="verifier"></pre></details>
<details><summary>Noetic trace</summary><pre id="trace"></pre></details>
<details open><summary>Summary</summary><pre id="summary"></pre></details>
<script>
window.addEventListener('message', e => {
  for (const k of ['english','verifier','trace','summary']) document.getElementById(k).textContent = e.data[k] || '';
});
</script></body></html>`;
}
