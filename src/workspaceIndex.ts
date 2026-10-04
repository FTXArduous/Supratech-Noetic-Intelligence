import * as vscode from 'vscode';

interface IndexedFile {
  path: string;
  content: string;
}

const MAX_FILES = 300;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_RESULTS = 6;
const MAX_RESULT_CHARS = 1800;
const MAX_CONTEXT_CHARS = 24000;
const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.dart', '.go', '.h', '.hpp', '.html', '.java', '.js', '.jsx',
  '.json', '.kt', '.md', '.php', '.ps1', '.py', '.rb', '.rs', '.sh', '.sql', '.swift', '.toml', '.ts',
  '.tsx', '.txt', '.vue', '.xml', '.yaml', '.yml', '.svelte',
]);
const EXCLUDED_PATHS = /(^|\/)(\.git|\.vscode|node_modules|out|dist|build|target|bin|obj|coverage|\.next|\.venv|venv|vendor)(\/|$)|(^|\/)(\.env[^/]*|[^/]*(secret|credential|private|id_rsa)[^/]*)$/i;
const STOP_WORDS = new Set([
  'about', 'after', 'also', 'and', 'are', 'because', 'could', 'from', 'have', 'into', 'just', 'more',
  'most', 'other', 'please', 'should', 'some', 'that', 'their', 'there', 'these', 'they', 'this',
  'those', 'through', 'want', 'what', 'when', 'where', 'which', 'with', 'would', 'your',
]);

export class WorkspaceIndex {
  private files: IndexedFile[] = [];
  private byteCount = 0;

  async load(): Promise<string> {
    if (!vscode.workspace.workspaceFolders?.length) return 'No workspace folder is open.';
    const paths = await vscode.workspace.findFiles('**/*', '**/{.git,.vscode,node_modules,out,dist,build,target,bin,obj,coverage,.next,.venv,venv,vendor}/**', MAX_FILES);
    const files: IndexedFile[] = [];
    let totalBytes = 0;

    for (const uri of paths) {
      const path = vscode.workspace.asRelativePath(uri);
      if (EXCLUDED_PATHS.test(path)) continue;
      const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
      if (!TEXT_EXTENSIONS.has(extension)) continue;
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > MAX_FILE_BYTES || totalBytes + stat.size > MAX_TOTAL_BYTES) continue;
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (bytes.includes(0)) continue;
        const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        files.push({ path, content });
        totalBytes += bytes.byteLength;
      } catch {
        continue;
      }
    }

    this.files = files;
    this.byteCount = totalBytes;
    return `Loaded ${files.length} text/source files (${(totalBytes / 1024).toFixed(0)} KB) into the session-only project index. Limits: ${MAX_FILES} discovered paths, ${MAX_FILE_BYTES / 1024} KB per file, ${MAX_TOTAL_BYTES / 1024 / 1024} MB total.`;
  }

  clear(): string {
    const count = this.files.length;
    this.files = [];
    this.byteCount = 0;
    return `Cleared ${count} indexed project files from memory.`;
  }

  hasIndex(): boolean {
    return this.files.length > 0;
  }

  async readRelevant(query: string): Promise<string> {
    const status = await this.load();
    return `${status}\n\n${this.retrieve(query)}`;
  }

  retrieve(query: string): string {
    if (this.files.length === 0) return 'No project index is currently loaded.';
    const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? [])]
      .filter((term) => !STOP_WORDS.has(term));
    const ranked = this.files.map((file) => {
      const haystack = `${file.path}\n${file.content}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { file, score };
    }).sort((a, b) => b.score - a.score);
    const fullProjectRequest = /\b(all|entire|whole|everything|available)\b/i.test(query);
    const selected = fullProjectRequest
      ? this.files
      : (ranked.filter(({ score }) => score > 0).slice(0, MAX_RESULTS).map(({ file }) => file));
    const sources: string[] = [];
    let remaining = MAX_CONTEXT_CHARS;
    for (const file of selected) {
      if (remaining <= 0) break;
      const contentLimit = fullProjectRequest ? remaining : Math.min(MAX_RESULT_CHARS, remaining);
      const excerpt = `FILE: ${file.path}\n${file.content.slice(0, contentLimit)}`;
      sources.push(excerpt);
      remaining -= excerpt.length;
    }
    const overview = this.files.slice(0, 100).map((file) => file.path).join('\n');
    const excerpts = sources.join('\n\n---\n\n');

    return [
      `Session-only project index: ${this.files.length} files, ${(this.byteCount / 1024).toFixed(0)} KB.`,
      `File overview (first 100):\n${overview}`,
      `${fullProjectRequest ? 'Project contents (bounded to 24,000 characters)' : `Relevant excerpts (up to ${MAX_RESULTS})`}:\n${excerpts || 'No excerpt matched the request terms; use the file overview to ask about a specific file.'}`,
    ].join('\n\n');
  }
}
