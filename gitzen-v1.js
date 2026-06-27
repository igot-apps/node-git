#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ==========================================
// 🎨 UI & TERMINAL HELPERS (Zero Dependencies)
// ==========================================
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m'
};

const log = (msg, color = c.reset) => console.log(`${color}${msg}${c.reset}`);
const success = (msg) => log(`✅ ${msg}`, c.green);
const error = (msg) => log(`❌ ${msg}`, c.red);
const info = (msg) => log(`ℹ️  ${msg}`, c.cyan);
const warn = (msg) => log(`⚠️  ${msg}`, c.yellow);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(`${c.cyan}${q}${c.reset} `, resolve));

async function selectMenu(title, choices) {
  console.log(`\n${c.bold}${c.blue}${title}${c.reset}`);
  choices.forEach((choice, i) => console.log(`  ${c.yellow}${i + 1}${c.reset}) ${choice}`));
  console.log(`  ${c.gray}0) Cancel${c.reset}\n`);
  
  while (true) {
    const ans = await ask('Select an option: ');
    const num = parseInt(ans);
    if (num === 0) return null;
    if (num > 0 && num <= choices.length) return num - 1;
    warn('Invalid choice, try again.');
  }
}

// ==========================================
// ⚙️ GIT EXECUTION HELPERS
// ==========================================
function runGit(args, silent = false) {
  try {
    const result = execSync(`git ${args}`, { encoding: 'utf8', stdio: silent ? 'pipe' : 'inherit' });
    return { success: true, output: result ? result.trim() : '' };
  } catch (e) {
    return { success: false, output: e.stderr ? e.stderr.trim() : e.message };
  }
}

function isGitRepo() {
  return fs.existsSync(path.join(process.cwd(), '.git'));
}

function getCurrentBranch() {
  const res = runGit('rev-parse --abbrev-ref HEAD', true);
  return res.success ? res.output : 'main';
}

// ==========================================
// 🚀 COMMANDS
// ==========================================

async function cmdSetup() {
  log('\n🛠️  Setting up GitZen for your project...\n', c.bold);

  if (!isGitRepo()) {
    info('Initializing Git repository...');
    runGit('init -b main', true);
    success('Git initialized!');
  } else {
    success('Git repository already exists.');
  }

  const userName = execSync('git config user.name || echo ""', { encoding: 'utf8' }).trim();
  if (!userName) {
    const name = await ask('Enter your name for Git commits: ');
    const email = await ask('Enter your email for Git commits: ');
    runGit(`config user.name "${name}"`, true);
    runGit(`config user.email "${email}"`, true);
    success('Git identity configured!');
  }

  const ignorePath = path.join(process.cwd(), '.gitignore');
  if (!fs.existsSync(ignorePath)) {
    const nodeIgnore = `node_modules/\ndist/\nbuild/\n.env\n.env.local\n*.log\n.DS_Store`;
    fs.writeFileSync(ignorePath, nodeIgnore);
    success('Created a standard Node.js .gitignore file.');
  }

  const remoteRes = runGit('remote get-url origin', true);
  if (!remoteRes.success) {
    log('\n🔗 Let\'s connect this to GitHub.', c.bold);
    log('Option A: If you have GitHub CLI (gh) installed, run "gh repo create" in your terminal first.', c.gray);
    const repoUrl = await ask('Option B: Paste your GitHub repository URL here (or press Enter to skip): ');
    
    if (repoUrl) {
      runGit(`remote add origin ${repoUrl}`, true);
      success('Remote origin added!');
    } else {
      warn('Skipped GitHub connection. You can add it later.');
    }
  } else {
    success(`Already connected to: ${remoteRes.output}`);
  }

  log('\n🎉 Setup complete! You can now use "save", "push", "undo", and "history".\n', c.bold + c.green);
}

async function cmdSave() {
  log('\n💾 Preparing to save your work locally...\n', c.bold);
  
  const status = runGit('status --porcelain', true);
  if (!status.output) {
    warn('No changes detected. Your project is already up to date!');
    return;
  }

  const files = status.output.split('\n');
  log(`Found ${files.length} changed file(s):`, c.dim);
  files.forEach(f => log(`  • ${f.trim().substring(2)}`, c.gray));

  let msg = await ask('\nCommit message (press Enter to auto-generate): ');
  if (!msg) {
    msg = `Update ${files.length} file${files.length > 1 ? 's' : ''}`;
    info(`Auto-generated message: "${msg}"`);
  }

  info('Staging and committing locally...');
  runGit('add .');
  const commitRes = runGit(`commit -m "${msg.replace(/"/g, '\\"')}"`, true);
  
  if (!commitRes.success) {
    error('Commit failed: ' + commitRes.output);
    return;
  }

  success(`Successfully saved locally! 💾`);
  info('Your code is safe on your computer. Run "push" when you are ready to sync to GitHub.');
}

async function cmdPush() {
  log('\n🚀 Pushing your local saves to GitHub...\n', c.bold);

  const remoteRes = runGit('remote get-url origin', true);
  if (!remoteRes.success) {
    error('No GitHub remote found!');
    info('Run "node gitzen.js setup" to connect to GitHub first.');
    return;
  }

  const branch = getCurrentBranch();
  info(`Pushing branch '${branch}' to GitHub...`);
  
  // We don't use silent=true here so the user sees the "Writing objects" progress
  const pushRes = runGit(`push -u origin ${branch}`); 
  
  if (pushRes.success) {
    success(`Successfully synced with GitHub! 🎉`);
  } else {
    error('Push failed.');
    log(pushRes.output, c.gray);
    info('Tip: If it says "rejected", your GitHub repo has newer code. You may need to pull first.');
  }
}

async function cmdUndo() {
  log('\n⏪ Time Machine: Reverting to a previous save...\n', c.bold);
  
  const logRes = runGit('log -n 10 --pretty=format:"%H|%ad|%s" --date=short', true);
  if (!logRes.output) {
    warn('No previous saves found to undo.');
    return;
  }

  const commits = logRes.output.split('\n').filter(Boolean);
  const choices = commits.map(cmt => {
    const [hash, date, msg] = cmt.split('|');
    return `${c.gray}[${date}]${c.reset} ${msg} ${c.dim}(${hash.substring(0,6)})${c.reset}`;
  });

  const idx = await selectMenu('Select a save to revert to:', choices);
  if (idx === null) return;

  const selectedHash = commits[idx].split('|')[0];
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupBranch = `gitzen-safety-${timestamp}`;
  info(`Creating safety backup branch: ${backupBranch}`);
  runGit(`branch ${backupBranch}`, true);

  info('Reverting files...');
  runGit(`reset --hard ${selectedHash}`);
  
  success('Reverted successfully!');
  log(`💡 If you made a mistake, your previous state is safe in branch: ${c.bold}${backupBranch}${c.reset}`, c.yellow);
}

async function cmdHistory() {
  log('\n📜 Project History\n', c.bold);
  
  const logRes = runGit('log --pretty=format:"%h | %ad | %s" --date=format:"%Y-%m-%d %H:%M"', true);
  if (!logRes.output) {
    warn('No history found.');
    return;
  }

  const lines = logRes.output.split('\n');
  console.log(c.dim + '─'.repeat(60) + c.reset);
  lines.forEach(line => {
    const parts = line.split(' | ');
    console.log(`${c.yellow}${parts[0]}${c.reset} | ${c.cyan}${parts[1]}${c.reset} | ${parts[2]}`);
  });
  console.log(c.dim + '─'.repeat(60) + c.reset + '\n');
}

// ==========================================
// 🏠 MAIN MENU
// ==========================================
async function main() {
  console.log(`\n${c.bold}${c.magenta}
   ██████╗ ██╗████████╗███████╗███╗   ██╗
  ██╔════╝ ██║╚══██╔══╝██╔════╝████╗  ██║
  ██║  ███╗██║   ██║   █████╗  ██╔██╗ ██║
  ██║   ██║██║   ██║   ██╔══╝  ██║╚██╗██║
  ╚██████╔╝██║   ██║   ███████╗██║ ╚████║
   ╚═════╝ ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝
  ${c.reset}${c.dim}Frictionless Git for Node.js Developers${c.reset}\n`);

  if (!isGitRepo()) {
    warn('This folder is not a Git repository yet.');
    info('Running initial setup...\n');
    await cmdSetup();
  }

  const action = process.argv[2];

  if (action === 'setup') return cmdSetup();
  if (action === 'save') return cmdSave();
  if (action === 'push') return cmdPush();
  if (action === 'undo') return cmdUndo();
  if (action === 'history') return cmdHistory();

  // Interactive Menu
  const choice = await selectMenu('What would you like to do?', [
    '💾 Save (Local Commit)',
    '🚀 Push (Sync to GitHub)',
    '⏪ Undo (Revert to previous save)',
    '📜 History (View past saves)',
    '🛠️  Setup (Re-configure GitHub/Ignore)'
  ]);

  if (choice === 0) await cmdSave();
  else if (choice === 1) await cmdPush();
  else if (choice === 2) await cmdUndo();
  else if (choice === 3) await cmdHistory();
  else if (choice === 4) await cmdSetup();
  
  rl.close();
}

main().catch(err => {
  error('Something went wrong: ' + err.message);
  rl.close();
});