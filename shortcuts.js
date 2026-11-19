'use strict';
// Desktop shortcut creation for downloaded applications.
// Kept separate from main.js so the platform-specific logic can be tested on its own.

const fsp = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

// Remove characters that are illegal in file names on at least one of the
// supported platforms, plus line breaks. Unicode letters are kept as-is.
function safeName(value) {
  const cleaned = String(value || 'RepoGit')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'RepoGit';
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || stdout.trim() || `Команда завершилась с кодом ${code}.`));
    });
  });
}

async function tempFile(extension, contents) {
  const file = path.join(os.tmpdir(), `repogit-shortcut-${crypto.randomUUID()}${extension}`);
  await fsp.writeFile(file, contents, 'utf8');
  return file;
}

// --- Windows: a real .lnk via WScript.Shell (PowerShell COM) ---
async function windowsShortcut({ desktop, name, target, icon }) {
  await fsp.mkdir(desktop, { recursive: true });
  const lnk = path.join(desktop, `${safeName(name)}.lnk`);
  const script = [
    'param([string]$TargetPath, [string]$ShortcutPath, [string]$IconPath)',
    '$shell = New-Object -ComObject WScript.Shell',
    '$shortcut = $shell.CreateShortcut($ShortcutPath)',
    '$shortcut.TargetPath = $TargetPath',
    '$shortcut.WorkingDirectory = Split-Path -Parent $TargetPath',
    '$shortcut.Description = "Запуск приложения из библиотеки RepoGit"',
    'if ($IconPath -and (Test-Path -LiteralPath $IconPath)) { $shortcut.IconLocation = "$IconPath,0" }',
    '$shortcut.Save()',
    ''
  ].join('\r\n');
  const scriptPath = await tempFile('.ps1', script);
  try {
    await run('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
      '-TargetPath', target, '-ShortcutPath', lnk, '-IconPath', icon || target
    ]);
  } finally {
    await fsp.rm(scriptPath, { force: true }).catch(() => {});
  }
  return lnk;
}

function escapeDesktopValue(value) {
  return String(value).replace(/[\r\n]/g, ' ').replace(/\\/g, '\\\\');
}

// Escape a path for the Exec key of a .desktop file (double-quoted form).
function escapeDesktopExec(target) {
  const escaped = String(target)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
  return `"${escaped}"`;
}

// --- Linux: a .desktop entry in ~/.local/share/applications and on the Desktop ---
async function linuxShortcut({ desktop, name, target, icon }) {
  const applications = path.join(os.homedir(), '.local', 'share', 'applications');
  await fsp.mkdir(applications, { recursive: true });
  const base = `${safeName(name)}-repogit`;
  const contents = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${escapeDesktopValue(name)}`,
    'Comment=Приложение из библиотеки RepoGit',
    `Exec=${escapeDesktopExec(target)}`,
    `Icon=${escapeDesktopValue(icon || target)}`,
    'Terminal=false',
    'Categories=Utility;',
    ''
  ].join('\n');

  await fsp.writeFile(path.join(applications, `${base}.desktop`), contents, { mode: 0o755 });
  if (desktop) {
    await fsp.mkdir(desktop, { recursive: true });
    const onDesktop = path.join(desktop, `${base}.desktop`);
    await fsp.writeFile(onDesktop, contents, { mode: 0o755 });
    await fsp.chmod(onDesktop, 0o755);
    return onDesktop;
  }
  return path.join(applications, `${base}.desktop`);
}

function escapeShellArg(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// --- macOS: Finder alias, with a .command launcher as a fallback ---
async function macShortcut({ desktop, name, target }) {
  await fsp.mkdir(desktop, { recursive: true });
  const script = [
    'on run argv',
    '  set targetFile to POSIX file (item 1 of argv)',
    '  set aliasName to item 2 of argv',
    '  tell application "Finder"',
    '    set newAlias to make new alias file at desktop to targetFile',
    '    set name of newAlias to aliasName',
    '    return POSIX path of (newAlias as alias)',
    '  end tell',
    'end run',
    ''
  ].join('\n');
  const scriptPath = await tempFile('.applescript', script);
  try {
    const output = await run('osascript', [scriptPath, target, safeName(name)]);
    if (output) return output;
  } catch {
    // Finder scripting can be blocked by automation permissions — use a
    // double-clickable shell launcher instead.
  } finally {
    await fsp.rm(scriptPath, { force: true }).catch(() => {});
  }

  const launcher = path.join(desktop, `${safeName(name)}.command`);
  const body = `#!/bin/sh\nopen ${escapeShellArg(target)}\n`;
  await fsp.writeFile(launcher, body, { mode: 0o755 });
  await fsp.chmod(launcher, 0o755);
  return launcher;
}

async function createDesktopShortcut({ platform, desktop, name, target, icon }) {
  if (!target || !path.isAbsolute(target)) throw new Error('Не удалось определить путь к приложению.');
  if (platform === 'win32') return windowsShortcut({ desktop, name, target, icon });
  if (platform === 'linux') return linuxShortcut({ desktop, name, target, icon });
  if (platform === 'darwin') return macShortcut({ desktop, name, target });
  throw new Error('Создание ярлыков поддерживается только в Windows, Linux и macOS.');
}

module.exports = { createDesktopShortcut, safeName };
