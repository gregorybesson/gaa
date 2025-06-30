import * as vscode from 'vscode';
import * as dotenv from 'dotenv';
import axios from 'axios';
import { exec } from 'child_process';
import * as path from 'path';
dotenv.config();

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('gaa.run', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const filePath = editor.document.fileName;
    const workspace = vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath;
    if (!workspace) return vscode.window.showErrorMessage("No workspace detected");

    try {
      // Debug logging
      console.log('Workspace:', workspace);
      console.log('FilePath:', filePath);
      
      const diff = await getGitDiff(workspace, filePath);
      if (!diff.trim()) {
        return vscode.window.showInformationMessage("No changes to review.");
      }

      vscode.window.showInformationMessage("Reviewing code with OpenAI...");

      const prompt = `
Tu es un reviewer de code expert. Voici un diff Git.
Analyse uniquement les parties modifiées et commente :

- ❌ Problèmes
- 💡 Suggestions
- ✅ Bonnes pratiques

\`\`\`diff
${diff}
\`\`\`
`;

      const feedback = await callOpenAI(prompt);
      await injectIntoCursor(feedback);

      vscode.window.showInformationMessage("✅ Review injected into Cursor.");

    } catch (err: any) {
      vscode.window.showErrorMessage("Erreur : " + err.message);
      console.error(err);
    }
  });

  context.subscriptions.push(disposable);
}

async function getGitDiff(workspace: string, filePath: string): Promise<string> {
  // Find the git root directory
  const gitRoot = await findGitRoot(path.dirname(filePath));
  if (!gitRoot) {
    throw new Error("No git repository found for this file");
  }
  
  const relative = path.relative(gitRoot, filePath);
  console.log('Git root:', gitRoot);
  console.log('Relative path:', relative);
  
  return new Promise((resolve, reject) => {
    exec(`git diff -- ${relative}`, { cwd: gitRoot }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

async function findGitRoot(startPath: string): Promise<string | null> {
  let currentPath = startPath;
  
  while (currentPath !== path.dirname(currentPath)) { // Stop at root directory
    const gitPath = path.join(currentPath, '.git');
    
    // Check if .git exists (directory or file for git worktrees)
    try {
      await new Promise((resolve, reject) => {
        exec('git rev-parse --git-dir', { cwd: currentPath }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        });
      });
      return currentPath; // Found git repository
    } catch (err) {
      // Not a git repository, try parent directory
      currentPath = path.dirname(currentPath);
    }
  }
  
  return null; // No git repository found
}

async function callOpenAI(prompt: string): Promise<string> {
  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'Tu es un reviewer concis, expert et bienveillant.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return res.data.choices[0].message.content.trim();
}

async function injectIntoCursor(content: string): Promise<void> {
  const escaped = content
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\n/g, "\\n");

  const scriptPath = path.join(__dirname, '..', 'scripts', 'inject.applescript');

  return new Promise((resolve, reject) => {
    exec(`osascript "${scriptPath}" "${escaped}"`, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Optional: add deactivate() if needed
export function deactivate() {}