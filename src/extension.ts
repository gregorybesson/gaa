import * as vscode from 'vscode';
import * as dotenv from 'dotenv';
import axios from 'axios';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables from multiple possible locations
function loadEnvironmentVariables() {
  // Use console.log here since our log function isn't available yet
  console.log('Loading environment variables...');
  
  // Try loading from current working directory
  const cwd = process.cwd();
  console.log('Current working directory:', cwd);
  
  const possibleEnvPaths = [
    path.join(cwd, '.env'),
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', '..', '.env'),
    path.join(process.env.HOME || process.env.USERPROFILE || '', '.env')
  ];
  
  for (const envPath of possibleEnvPaths) {
    console.log('Checking for .env at:', envPath);
    if (fs.existsSync(envPath)) {
      console.log('Found .env file at:', envPath);
      dotenv.config({ path: envPath });
      break;
    }
  }
  
  // Also try default dotenv config
  dotenv.config();
  
  console.log('Environment loading complete. OPENAI_API_KEY exists:', !!process.env.OPENAI_API_KEY);
}

loadEnvironmentVariables();

// Create output channel for better logging
const outputChannel = vscode.window.createOutputChannel('GAA Extension');

function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  outputChannel.appendLine(logMessage);
}

function getFileTypeContext(extension: string): string {
  const contexts: { [key: string]: string } = {
    '.js': 'JavaScript - Focus on ES6+ features, async/await, performance, and modern patterns',
    '.ts': 'TypeScript - Focus on type safety, interfaces, generics, and best practices',
    '.jsx': 'React JSX - Focus on component architecture, hooks, performance, and accessibility',
    '.tsx': 'React TypeScript - Focus on type-safe components, props, state management, and patterns',
    '.py': 'Python - Focus on PEP 8, type hints, performance, and Pythonic patterns',
    '.java': 'Java - Focus on OOP principles, design patterns, exception handling, and performance',
    '.cpp': 'C++ - Focus on memory management, RAII, modern C++ features, and performance',
    '.c': 'C - Focus on memory safety, pointer usage, and system programming best practices',
    '.go': 'Go - Focus on goroutines, channels, error handling, and Go idioms',
    '.rs': 'Rust - Focus on ownership, borrowing, safety, and performance',
    '.php': 'PHP - We use Symfony 7.1 and PHP 8.4 and API Platform 4. Always check that the best practices of these frameworks are followed.',
    '.rb': 'Ruby - Focus on Ruby idioms, metaprogramming, and Rails patterns if applicable',
    '.swift': 'Swift - Focus on optionals, protocol-oriented programming, and iOS best practices',
    '.kt': 'Kotlin - Focus on null safety, coroutines, and Android development patterns',
    '.cs': 'C# - Focus on LINQ, async/await, .NET patterns, and memory management',
    '.html': 'HTML - Focus on semantic markup, accessibility, and web standards',
    '.css': 'CSS - Focus on responsive design, performance, and modern CSS features',
    '.scss': 'SCSS/Sass - Focus on mixins, variables, nesting best practices, and maintainability',
    '.sql': 'SQL - Focus on query optimization, security (SQL injection), and database design',
    '.sh': 'Shell Script - Focus on portability, error handling, and security',
    '.yml': 'YAML - Focus on syntax correctness, security, and configuration best practices',
    '.json': 'JSON - Focus on structure, validation, and security considerations',
    '.md': 'Markdown - Focus on formatting, accessibility, and documentation standards'
  };
  
  return contexts[extension] || `${extension} file - General code review focusing on readability, maintainability, and best practices`;
}

async function insertIntoActiveEditor(content: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    throw new Error('No active editor found');
  }

  const position = editor.selection.active;
  
  // Use the same simple formatting as injectIntoCursor
  const cleanContent = content.trim();
  
  let formattedContent: string;
  if (cleanContent.includes('REVIEW: Code looks good. No significant issues found.')) {
    formattedContent = `

/*
 * -----------------------------------------------------------
 * GAA CODE REVIEW
 * -----------------------------------------------------------
 * 
 * RESULT: No significant issues found - code looks good!
 * 
 * -----------------------------------------------------------
 */

`;
  } else {
    formattedContent = `

/*
 * -----------------------------------------------------------
 * GAA CODE REVIEW  
 * -----------------------------------------------------------
 * 
${cleanContent.split('\n').map(line => ' * ' + line).join('\n')}
 * 
 * -----------------------------------------------------------
 */

`;
  }
  
  await editor.edit(editBuilder => {
    editBuilder.insert(position, formattedContent);
  });
  
  log('Review inserted into active editor');
}

export function activate(context: vscode.ExtensionContext) {
  log('GAA Extension activated');
  
  // Show output channel on first activation
  outputChannel.show(true);
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
      
      log(`Git diff result length: ${diff.length}`);
      log(`Git diff preview (first 200 chars): ${diff.substring(0, 200)}`);
      
      if (!diff.trim()) {
        // Additional debugging for "no changes" case
        log("No git diff found - checking git status...");
        await debugGitStatus(workspace, filePath);
        return vscode.window.showInformationMessage("No changes to review. Check GAA Extension output for details.");
      }

      const showPreview = await vscode.window.showQuickPick(["Oui", "Non"], {
        placeHolder: "Souhaitez-vous prévisualiser la réponse avant l'injection ?"
      });
      if (showPreview === "Non") {
        vscode.window.showInformationMessage("Reviewing code with OpenAI...");
      }

      // Detect file extension for context-aware review
      const fileExtension = path.extname(filePath).toLowerCase();
      const fileName = path.basename(filePath);
      
      const prompt = `
TASK: Review this Git diff for CRITICAL ISSUES ONLY.

File: ${fileName}
Context: ${getFileTypeContext(fileExtension)}

CRITICAL ISSUES are:
- Security vulnerabilities
- Bugs that cause incorrect behavior
- Major performance problems
- Style issues
- Best practices
- Code quality suggestions

IGNORE:
- Positive feedback

RESPONSE:
If you find critical issues, list them like this:
ISSUES FOUND:
1. [Line X] Security issue - specific fix
2. [Line Y] Bug - specific fix

If NO critical issues found, respond with EXACTLY:
REVIEW: Code looks good. No significant issues found.

Git diff:
${diff}
`;

      const feedback = await callOpenAI(prompt);
      
      // Use direct editor insertion instead of AppleScript to avoid character encoding issues
      // AppleScript was converting characters like "=" to "q" causing formatting problems
      await injectIntoCursor(feedback);

      vscode.window.showInformationMessage("✅ Code review inserted into active editor.");

    } catch (err: any) {
      vscode.window.showErrorMessage("Erreur : " + err.message);
      console.error(err);
    }
  });

  context.subscriptions.push(disposable);
}

async function getGitDiff(workspace: string, filePath: string): Promise<string> {
  console.log('getGitDiff - Input filePath:', filePath);
  console.log('getGitDiff - Input workspace:', workspace);
  
  // Find the git root directory
  const startDir = path.dirname(filePath);
  console.log('getGitDiff - Starting search from:', startDir);
  
  let gitRoot = await findGitRoot(startDir);
  
  // Fallback: try to use workspace if it's a git repository
  if (!gitRoot) {
    console.log('getGitDiff - Git root not found, trying workspace as fallback:', workspace);
    try {
      await new Promise((resolve, reject) => {
        exec('git rev-parse --git-dir', { cwd: workspace }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        });
      });
      gitRoot = workspace;
      console.log('getGitDiff - Using workspace as git root:', gitRoot);
    } catch (err) {
      console.log('getGitDiff - Workspace is also not a git repository');
    }
  }
  
  if (!gitRoot) {
    throw new Error(`No git repository found. Searched from: ${startDir}, workspace: ${workspace}`);
  }
  
  const relative = path.relative(gitRoot, filePath);
  log(`getGitDiff - Git root found: ${gitRoot}`);
  log(`getGitDiff - Relative path: ${relative}`);
  log(`getGitDiff - Command will be: git diff -- ${relative}`);
  
  return new Promise((resolve, reject) => {
    // Try different git diff commands to catch all types of changes
    const commands = [
      `git diff -- "${relative}"`,           // Working tree vs index
      `git diff --cached -- "${relative}"`,  // Index vs HEAD (staged changes)
      `git diff HEAD -- "${relative}"`       // Working tree vs HEAD (all changes)
    ];
    
    log(`getGitDiff - Trying multiple git diff commands for: ${relative}`);
    
    let allDiffs = '';
    let commandIndex = 0;
    
    const tryNextCommand = () => {
      if (commandIndex >= commands.length) {
        if (allDiffs.trim()) {
          log(`getGitDiff - Combined diff length: ${allDiffs.length}`);
          resolve(allDiffs);
        } else {
          log(`getGitDiff - No changes found with any git diff command`);
          resolve('');
        }
        return;
      }
      
      const command = commands[commandIndex];
      log(`getGitDiff - Executing: ${command} in ${gitRoot}`);
      
      exec(command, { cwd: gitRoot }, (err, stdout, stderr) => {
        if (err) {
          log(`getGitDiff - Command ${commandIndex + 1} failed: ${err.message}`);
        } else {
          log(`getGitDiff - Command ${commandIndex + 1} returned ${stdout.length} characters`);
          if (stdout.trim()) {
            allDiffs += `\n=== ${command} ===\n${stdout}`;
          }
        }
        
        commandIndex++;
        tryNextCommand();
      });
    };
    
    tryNextCommand();
  });
}

async function findGitRoot(startPath: string): Promise<string | null> {
  log(`findGitRoot - Starting search from: ${startPath}`);
  let currentPath = startPath;
  
  while (currentPath !== path.dirname(currentPath)) { // Stop at root directory
    log(`findGitRoot - Checking path: ${currentPath}`);
    
    // Check if .git exists (directory or file for git worktrees)
    try {
      await new Promise((resolve, reject) => {
        exec('git rev-parse --git-dir', { cwd: currentPath }, (err, stdout) => {
          if (err) {
            log(`findGitRoot - Not a git repo: ${currentPath} - ${err.message}`);
            reject(err);
          } else {
            log(`findGitRoot - Found git repo at: ${currentPath}`);
            resolve(stdout);
          }
        });
      });
      return currentPath; // Found git repository
    } catch (err) {
      // Not a git repository, try parent directory
      const parentPath = path.dirname(currentPath);
      log(`findGitRoot - Moving up from ${currentPath} to ${parentPath}`);
      currentPath = parentPath;
    }
  }
  
  log('findGitRoot - No git repository found, reached root');
  return null; // No git repository found
}

async function debugGitStatus(workspace: string, filePath: string): Promise<void> {
  const startDir = path.dirname(filePath);
  const fileName = path.basename(filePath);
  
  log(`=== DEBUGGING GIT STATUS ===`);
  log(`File: ${fileName}`);
  log(`File path: ${filePath}`);
  log(`Workspace: ${workspace}`);
  log(`Start directory: ${startDir}`);
  
  // Check if file exists
  log(`File exists: ${require('fs').existsSync(filePath)}`);
  
  // Try git status in different directories
  const dirsToCheck = [
    startDir,
    workspace,
    path.dirname(startDir),
    path.dirname(workspace)
  ];
  
  for (const dir of dirsToCheck) {
    if (!dir || dir === '/') continue;
    
    log(`--- Checking directory: ${dir} ---`);
    
    try {
      // Check if it's a git repository
      const gitDir = await new Promise<string>((resolve, reject) => {
        exec('git rev-parse --git-dir', { cwd: dir }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim());
        });
      });
      log(`✓ Git directory found: ${gitDir}`);
      
      // Check git status
      const status = await new Promise<string>((resolve, reject) => {
        exec('git status --porcelain', { cwd: dir }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        });
      });
      log(`Git status output: ${status || '(no changes)'}`);
      
      // Check if our specific file has changes
      const relativePath = path.relative(dir, filePath);
      log(`Relative path from ${dir}: ${relativePath}`);
      
      const fileDiff = await new Promise<string>((resolve, reject) => {
        exec(`git diff -- "${relativePath}"`, { cwd: dir }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        });
      });
      log(`File diff length: ${fileDiff.length}`);
      
      if (fileDiff.trim()) {
        log(`✓ Found changes in ${dir}!`);
        log(`Diff preview: ${fileDiff.substring(0, 300)}`);
      }
      
    } catch (error: any) {
      log(`✗ Not a git repository: ${error.message}`);
    }
  }
  
  log(`=== END DEBUGGING ===`);
}

async function callOpenAI(prompt: string): Promise<string> {
  // Debug API key loading
  log('callOpenAI - Checking API key...');
  log(`callOpenAI - process.env.OPENAI_API_KEY exists: ${!!process.env.OPENAI_API_KEY}`);
  log(`callOpenAI - API key length: ${process.env.OPENAI_API_KEY?.length || 0}`);
  log(`callOpenAI - API key prefix: ${process.env.OPENAI_API_KEY?.substring(0, 10) || 'MISSING'}`);
  
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not found in environment variables. Please set it in your system environment or .env file.');
  }
  
  if (!apiKey.startsWith('sk-')) {
    throw new Error('Invalid OpenAI API key format. It should start with "sk-"');
  }

  const systemMessage = 'You are a strict code reviewer. ONLY report issues (security vulnerabilities, bugs, performance problems, best practices to adopt). If there are no issues, respond with exactly: "REVIEW: Code looks good. No significant issues found." Do not provide positive feedback, style suggestions, or explanations unless there are issues.';
  
  // DEBUG: Log the exact messages being sent
  log('=== OPENAI DEBUG START ===');
  log('Model: gpt-4');
  log('Temperature: 0.1');
  log('System Message:');
  log(systemMessage);
  log('User Prompt:');
  log(prompt);
  log('=== OPENAI DEBUG END ===');

  try {
    const requestBody = {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1
    };

    log('Sending request to OpenAI...');
    const res = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const response = res.data.choices[0].message.content.trim();
    
    // DEBUG: Log the response
    log('=== OPENAI RESPONSE DEBUG START ===');
    log('Raw Response:');
    log(response);
         log(`Response Length: ${response.length}`);
    log('=== OPENAI RESPONSE DEBUG END ===');

    return response;
  } catch (error: any) {
    if (error.response?.status === 401) {
      throw new Error(`OpenAI API authentication failed. Please check your API key. Status: ${error.response.status}`);
    } else if (error.response?.status === 429) {
      throw new Error(`OpenAI API rate limit exceeded. Please try again later. Status: ${error.response.status}`);
    } else if (error.response?.status) {
      throw new Error(`OpenAI API error: ${error.response.status} - ${error.response.data?.error?.message || error.message}`);
    } else {
      throw new Error(`Network error: ${error.message}`);
    }
  }
}

async function showReviewInNewDocument(content: string): Promise<void> {
  try {
    // Create a new untitled document with the review
    const document = await vscode.workspace.openTextDocument({
      content: content,
      language: 'markdown' // Format as markdown for better readability
    });
    
    // Show the document in a new editor
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.Beside, // Open beside current editor
      preserveFocus: false // Focus on the new document
    });
    
    log('Review displayed in new document');
  } catch (error: any) {
    log(`Error showing review: ${error.message}`);
    throw error;
  }
  }

async function injectIntoCursor(content: string): Promise<void> {
  // Encode the prompt cleanly as AppleScript input (double quote escaped only)
  let safeText = content.replace(/"/g, '\\"');
  safeText = content
    .replace(/"/g, "'");

  const appleScript = `
    tell application "Cursor"
      activate
      delay 0.5
    end tell
    tell application "System Events"
      keystroke "${safeText}"
      key code 36
    end tell
  `;

  return new Promise((resolve, reject) => {
    // Write AppleScript to temporary file to avoid command line length limits
    const tempFile = path.join(__dirname, 'temp_inject.scpt');
    
    require('fs').writeFileSync(tempFile, appleScript);
    
    exec(`osascript "${tempFile}"`, (err) => {
      // Clean up temp file
      try {
        require('fs').unlinkSync(tempFile);
      } catch (e) {
        // Ignore cleanup errors
      }
      
      if (err) reject(err);
      else resolve();
    });
  });
}

// Optional: add deactivate() if needed
export function deactivate() {}

/**
 * 
 * 
 

You are a senior code-review assistant. The user will supply two branch names (for example "feature/x" and "develop"). Your job is to:

0. **High-Level Summary**  
   In 2–3 sentences, describe:  
   – **Product impact**: What does this change deliver for users or customers?  
   – **Engineering approach**: Key patterns, frameworks, or best practices in use.

1. **Fetch and scope the diff**  
   - Run `git fetch origin` and check out the remote branches (`origin/feature/x`, `origin/develop`) to ensure you have the absolute latest code.  
   - Compute `git diff --name-only --diff-filter=M origin/develop...origin/feature/x` to list only modified files.  
   - For each file in that list, run `git diff --quiet origin/develop...origin/feature/x -- <file>`; skip any file that produces no actual diff hunks.

2. **Evaluation Criteria**
   For each truly changed file and each diffed hunk, evaluate only those lines against:
   - **Design & Architecture**: Verify the change fits your system’s architectural patterns, avoids unnecessary coupling or speculative features, enforces clear separation of concerns, and aligns with defined module boundaries.
   - **Complexity & Maintainability**: Ensure control flow remains flat, cyclomatic complexity stays low, duplicate logic is abstracted (DRY), dead or unreachable code is removed, and any dense logic is refactored into testable helper methods.
   - **Functionality & Correctness**: Confirm new code paths behave correctly under valid and invalid inputs, cover all edge cases, maintain idempotency for retry-safe operations, satisfy all functional requirements or user stories, and include robust error-handling semantics.
   - **Readability & Naming**: Check that identifiers clearly convey intent, comments explain *why* (not *what*), code blocks are logically ordered, and no surprising side-effects hide behind deceptively simple names.
   - **Best Practices & Patterns**: Validate use of language- or framework-specific idioms, adherence to SOLID principles, proper resource cleanup, consistent logging/tracing, and clear separation of responsibilities across layers.
   - **Test Coverage & Quality**: Verify unit tests for both success and failure paths, integration tests exercising end-to-end flows, appropriate use of mocks/stubs, meaningful assertions (including edge-case inputs), and that test names accurately describe behavior.
   - **Standardization & Style**: Ensure conformance to style guides (indentation, import/order, naming conventions), consistent project structure (folder/file placement), and zero new linter or formatter warnings.
   - **Documentation & Comments**: Confirm public APIs or complex algorithms have clear in-code documentation, and that README, Swagger/OpenAPI, CHANGELOG, or other user-facing docs are updated to reflect visible changes or configuration tweaks.
   - **Security & Compliance**: Check input validation and sanitization against injection attacks, proper output encoding, secure error handling, dependency license and vulnerability checks, secrets management best practices, enforcement of authZ/authN, and relevant regulatory compliance (e.g. GDPR, HIPAA).
   - **Performance & Scalability**: Identify N+1 query patterns or inefficient I/O (streaming vs. buffering), memory management concerns, heavy hot-path computations, or unnecessary UI re-renders; suggest caching, batching, memoization, async patterns, or algorithmic optimizations.
   - **Observability & Logging**: Verify that key events emit metrics or tracing spans, logs use appropriate levels, sensitive data is redacted, and contextual information is included to support monitoring, alerting, and post-mortem debugging.
   - **Accessibility & Internationalization**: For UI code, ensure use of semantic HTML, correct ARIA attributes, keyboard navigability, color-contrast considerations, and that all user-facing strings are externalized for localization.
   - **CI/CD & DevOps**: Validate build pipeline integrity (automated test gating, artifact creation), infra-as-code correctness, dependency declarations, deployment/rollback strategies, and adherence to organizational DevOps best practices.
   - **AI-Assisted Code Review**: For AI-generated snippets, ensure alignment with your architectural and naming conventions, absence of hidden dependencies or licensing conflicts, inclusion of tests and docs, and consistent style alongside human-authored code.

3. **Report issues in nested bullets**  
   For each validated issue, output a nested bullet like this:  
   - File: `<path>:<line-range>`  
     - Issue: [One-line summary of the root problem]  
     - Fix: [Concise suggested change or code snippet]  

4. **Prioritized Issues**  
   Title this section `## Prioritized Issues` and present all bullets from step 3 grouped by severity in this order-Critical, Major, Minor, Enhancement-with no extra prose:  
   ### Critical  
   - …  
   ### Major  
   - …  
   ### Minor  
   - …  
   ### Enhancement  
   - …

5. **Highlights**  
   After the prioritized issues, include a brief bulleted list of positive findings or well-implemented patterns observed in the diff.

Throughout, maintain a polite, professional tone; keep comments as brief as possible without losing clarity; and ensure you only analyze files with actual content changes.
 */