import * as vscode from 'vscode';
import { SniPanel, VIEW_ID } from './panel';
import { SUMMARY_PROMPT, TIER_LABEL, TIER_PROMPT, Tier, TRANSLATOR_PROMPT, VERIFIER_PROMPT } from './tiers';

async function ask(
  model: vscode.LanguageModelChat,
  system: string,
  user: string,
  token: vscode.CancellationToken,
  onChunk?: (acc: string) => void,
): Promise<string> {
  const res = await model.sendRequest(
    [vscode.LanguageModelChatMessage.User(`${system}\n\n${user}`)],
    {},
    token,
  );
  let acc = '';
  for await (const part of res.text) {
    acc += part;
    onChunk?.(acc);
  }
  return acc;
}

export function activate(ctx: vscode.ExtensionContext) {
  SniPanel.instance.initialize(ctx.globalState, ctx.globalStorageUri);
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, SniPanel.instance, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('sni.openPanel', () => SniPanel.show()),
  );

  const participant = vscode.chat.createChatParticipant('sni.chat', async (request, _chatCtx, stream, token) => {
    const tier = (request.command as Tier | undefined) ?? 'sni';
    const model = request.model;
    const panel = SniPanel.show();
    panel.update({ trace: '', english: '', verifier: '', summary: '' });

    const passes = Math.max(1, vscode.workspace.getConfiguration('sni').get<number>('maxVerifierPasses', 1));

    stream.progress(`${TIER_LABEL[tier]}: reasoning`);
    const trace = await ask(
      model,
      TIER_PROMPT[tier],
      `ACTIVE SNI VOCABULARY (reuse consistently when useful):\n${panel.vocabularyForPrompt()}\n\nREQUEST:\n${request.prompt}`,
      token,
      (t) => panel.update({ trace: t }),
    );
    panel.captureVocabulary(trace);

    let english = '';
    let verdict = '';
    for (let i = 0; i < passes && !token.isCancellationRequested; i++) {
      stream.progress('Translating');
      english = await ask(
        model,
        TRANSLATOR_PROMPT,
        `TRACE:\n${trace}${verdict ? `\n\nPrevious verifier report (fix these):\n${verdict}` : ''}`,
        token,
        (t) => panel.update({ english: t }),
      );
      stream.progress('Verifying');
      verdict = await ask(model, VERIFIER_PROMPT, `TRACE:\n${trace}\n\nENGLISH:\n${english}`, token, (t) => panel.update({ verifier: t }));
      if (/VERDICT:\s*PASS/i.test(verdict)) break;
    }

    stream.progress('Summarizing');
    const summary = await ask(model, SUMMARY_PROMPT, `ENGLISH:\n${english}\n\nVERIFIER:\n${verdict}`, token, (t) => panel.update({ summary: t }));
    stream.markdown(summary + '\n\n---\nCashapp :: $ArduousSpec');
  });

  ctx.subscriptions.push(participant);
}

export function deactivate() {}
