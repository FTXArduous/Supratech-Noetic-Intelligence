import * as vscode from 'vscode';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export interface PanelState {
  trace: string;
  english: string;
  verifier: string;
  summary: string;
  languageEnabled: boolean;
  languageTerms: VocabularyEntry[];
  projectIndexStatus: string;
}

interface VocabularyEntry {
  term: string;
  definition: string;
}

export const VIEW_ID = 'sni.view';
const LANGUAGE_KEY = 'sni.language.v1';
const LANGUAGE_ENABLED_KEY = 'sni.language.enabled';
const MAX_LANGUAGE_ENTRIES = 500;

export class SniPanel implements vscode.WebviewViewProvider {
  static readonly instance = new SniPanel();
  private view: vscode.WebviewView | undefined;
  private storage: vscode.Memento | undefined;
  private storageUri: vscode.Uri | undefined;
  private state: PanelState = {
    trace: '', english: '', verifier: '', summary: '', languageEnabled: true, languageTerms: [], projectIndexStatus: 'No project index loaded (session only).',
  };

  initialize(storage: vscode.Memento, storageUri: vscode.Uri) {
    this.storage = storage;
    this.storageUri = storageUri;
    this.state.languageEnabled = storage.get<boolean>(LANGUAGE_ENABLED_KEY, true);
    this.state.languageTerms = storage.get<VocabularyEntry[]>(LANGUAGE_KEY, []);
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = html();
    view.onDidDispose(() => (this.view = undefined));
    view.webview.onDidReceiveMessage(async (message: { type?: string; enabled?: boolean }) => {
      if (message.type === 'language-enabled' && typeof message.enabled === 'boolean') {
        this.setLanguageEnabled(message.enabled);
      } else if (message.type === 'language-archive') {
        await this.archiveAndReset();
      } else if (message.type === 'language-load') {
        await this.loadArchive();
      } else if (message.type === 'project-index-load') {
        await vscode.commands.executeCommand('sni.loadProjectIndex');
      } else if (message.type === 'project-index-clear') {
        await vscode.commands.executeCommand('sni.clearProjectIndex');
      }
    });
    this.publish();
  }

  static show(): SniPanel {
    const p = SniPanel.instance;
    if (p.view) p.view.show(true);
    else vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    return p;
  }

  update(patch: Partial<PanelState>) {
    this.state = { ...this.state, ...patch };
    this.publish();
  }

  setProjectIndexStatus(projectIndexStatus: string) {
    this.update({ projectIndexStatus });
  }

  vocabularyForPrompt(): string {
    if (!this.state.languageEnabled || this.state.languageTerms.length === 0) return 'No saved SNI vocabulary is active.';
    return this.state.languageTerms.map(({ term, definition }) => `${term} :: ${definition}`).join('\n');
  }

  captureVocabulary(trace: string) {
    if (!this.state.languageEnabled) return;
    const section = trace.split(/^LEXICON DELTA:\s*$/im).at(1);
    if (!section) return;

    const known = new Set(this.state.languageTerms.map((entry) => entry.term.toLocaleLowerCase()));
    for (const line of section.split(/\r?\n/)) {
      const match = line.match(/^\s*([\p{L}\p{N}_-]{2,40})\s*::\s*(.{1,300})\s*$/u);
      if (!match) continue;
      const term = match[1];
      if (known.has(term.toLocaleLowerCase())) continue;
      this.state.languageTerms.push({ term, definition: match[2] });
      known.add(term.toLocaleLowerCase());
      if (this.state.languageTerms.length >= MAX_LANGUAGE_ENTRIES) break;
    }
    void this.storage?.update(LANGUAGE_KEY, this.state.languageTerms);
    this.publish();
  }

  private setLanguageEnabled(enabled: boolean) {
    this.state.languageEnabled = enabled;
    void this.storage?.update(LANGUAGE_ENABLED_KEY, enabled);
    this.publish();
  }

  private async archiveAndReset() {
    if (this.state.languageTerms.length === 0 || !this.storage || !this.storageUri) return;
    try {
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.joinPath(this.storageUri, 'sni-language-backup.zip'),
        filters: { 'ZIP archive': ['zip'] },
        saveLabel: 'Archive language and start fresh',
      });
      if (!target) return;

      const entries = this.state.languageTerms;
      const archive = zipSync({
        'sni-language.json': strToU8(JSON.stringify({ schemaVersion: 1, archivedAt: new Date().toISOString(), entries }, null, 2)),
        'README.txt': strToU8('SNI invented-language archive. Restore by importing sni-language.json entries into SNI language storage.'),
      });
      await vscode.workspace.fs.writeFile(target, archive);
      await this.storage.update(LANGUAGE_KEY, []);
      this.state.languageTerms = [];
      this.publish();
      void vscode.window.showInformationMessage(`Archived ${entries.length} SNI language terms to ${target.fsPath}. New traces will start a fresh language set.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`SNI could not archive the language; saved terms were not cleared. ${message}`);
    }
  }

  private async loadArchive() {
    if (!this.storage || !this.storageUri) return;
    try {
      const picked = await vscode.window.showOpenDialog({
        defaultUri: this.storageUri,
        canSelectMany: false,
        filters: { 'ZIP archive': ['zip'] },
        openLabel: 'Load archived language',
      });
      if (!picked?.[0]) return;

      const files = unzipSync(await vscode.workspace.fs.readFile(picked[0]));
      const raw = files['sni-language.json'];
      if (!raw) throw new Error('sni-language.json not found in archive.');
      const parsed = JSON.parse(strFromU8(raw)) as { entries?: unknown };
      if (!Array.isArray(parsed.entries)) throw new Error('Archive has no entries list.');

      const known = new Set(this.state.languageTerms.map((entry) => entry.term.toLocaleLowerCase()));
      let added = 0;
      for (const item of parsed.entries as Partial<VocabularyEntry>[]) {
        if (this.state.languageTerms.length >= MAX_LANGUAGE_ENTRIES) break;
        if (typeof item?.term !== 'string' || typeof item.definition !== 'string') continue;
        const term = item.term.trim().slice(0, 40);
        const definition = item.definition.trim().slice(0, 300);
        if (!/^[\p{L}\p{N}_-]{2,40}$/u.test(term) || !definition || known.has(term.toLocaleLowerCase())) continue;
        this.state.languageTerms.push({ term, definition });
        known.add(term.toLocaleLowerCase());
        added++;
      }
      await this.storage.update(LANGUAGE_KEY, this.state.languageTerms);
      this.publish();
      void vscode.window.showInformationMessage(`Loaded ${added} archived SNI language terms into the active language.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`SNI could not load the archive. ${message}`);
    }
  }

  private publish() {
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
button{color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;padding:5px 8px;cursor:pointer}
.language-controls{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
</style></head>
<body>
<div id="pay">Cashapp :: $ArduousSpec</div>
<details open><summary>Invented language</summary>
<div class="language-controls"><label><input id="languageEnabled" type="checkbox"> Reuse &amp; expand saved language</label><button id="archiveLanguage" type="button">Archive &amp; start fresh</button></div>
<p><button id="loadLanguage" type="button">Load archived language</button></p>
<p id="languageCount"></p><pre id="languageList"></pre>
<hr>
<div class="language-controls"><button id="loadProjectIndex" type="button">Load project index</button><button id="clearProjectIndex" type="button">Clear project index</button></div>
<p id="projectIndexStatus"></p>
</details>
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
const vscode = acquireVsCodeApi();
document.getElementById('languageEnabled').addEventListener('change', e => vscode.postMessage({type:'language-enabled',enabled:e.target.checked}));
document.getElementById('archiveLanguage').addEventListener('click', () => {
  if (confirm('Save the current SNI language as a ZIP archive, then clear it and start a fresh language set?')) vscode.postMessage({type:'language-archive'});
});
document.getElementById('loadLanguage').addEventListener('click', () => vscode.postMessage({type:'language-load'}));
document.getElementById('loadProjectIndex').addEventListener('click', () => vscode.postMessage({type:'project-index-load'}));
document.getElementById('clearProjectIndex').addEventListener('click', () => vscode.postMessage({type:'project-index-clear'}));
window.addEventListener('message', e => {
  for (const k of ['english','verifier','trace','summary']) document.getElementById(k).textContent = e.data[k] || '';
  document.getElementById('languageEnabled').checked = e.data.languageEnabled;
  const entries = e.data.languageTerms || [];
  document.getElementById('archiveLanguage').disabled = entries.length === 0;
  document.getElementById('languageCount').textContent = entries.length + ' saved terms' + (e.data.languageEnabled ? ' (active)' : ' (paused)');
  document.getElementById('languageList').textContent = entries.map(item => item.term + ' :: ' + item.definition).join('\\n');
  document.getElementById('projectIndexStatus').textContent = e.data.projectIndexStatus || 'No project index loaded (session only).';
});
</script></body></html>`;
}
