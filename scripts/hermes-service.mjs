import { spawn, spawnSync } from 'node:child_process';
import { openSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const dataDir = path.join(rootDir, 'data');
const logsDir = path.join(rootDir, 'logs');
const watchdogPidPath = path.join(dataDir, 'hermes-watchdog.pid');
const supervisorPidPath = path.join(dataDir, 'hermes-supervisor.pid');
const botPidPath = path.join(dataDir, 'hermes-bot.pid');
const pidPath = watchdogPidPath;
const serviceStatePath = path.join(dataDir, 'hermes-service.json');
const botScript = path.join(rootDir, 'bot', 'hermes-bot.js');
const watchdogScript = path.join(rootDir, 'scripts', 'hermes-watchdog.mjs');
const supervisorScript = path.join(rootDir, 'scripts', 'hermes-supervisor.mjs');
const launcherScript = path.join(
  rootDir,
  'scripts',
  'hermes-start-supervisor.ps1',
);
const outLog = path.join(logsDir, 'hermes-bot.out.log');
const errLog = path.join(logsDir, 'hermes-bot.err.log');
const taskName = 'HermesTelegramBot';
const startupFileName = 'HermesTelegramBot.vbs';
const command = process.argv[2] || 'status';

dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });

function maskStatus(name) {
  const value = process.env[name] || '';
  return value ? `set (${value.length} chars)` : 'missing';
}

async function readPid(filePath = pidPath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    const pid = Number(raw.trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getCommandLine(pid) {
  if (process.platform !== 'win32') {
    return '';
  }

  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue; if ($p) { $p.CommandLine }`,
    ],
    { encoding: 'utf8' },
  );

  return result.stdout.trim();
}

function isHermesProcess(pid) {
  const commandLine = getCommandLine(pid).replaceAll('\\\\', '/');
  return (
    commandLine.includes('bot/hermes-bot.js') ||
    commandLine.includes('bot\\hermes-bot.js') ||
    commandLine.includes('scripts/hermes-supervisor.mjs') ||
    commandLine.includes('scripts\\hermes-supervisor.mjs') ||
    commandLine.includes('scripts/hermes-watchdog.mjs') ||
    commandLine.includes('scripts\\hermes-watchdog.mjs')
  );
}

function findHermesWatchdogPids() {
  if (process.platform !== 'win32') {
    return [];
  }

  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      [
        "$items = Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\"",
        `$items | Where-Object { $_.CommandLine -like '*hermes-watchdog.mjs*' -and $_.ProcessId -ne ${process.pid} } | ForEach-Object { $_.ProcessId }`,
      ].join('; '),
    ],
    { encoding: 'utf8' },
  );

  return result.stdout
    .split(/\s+/)
    .map(value => Number(value.trim()))
    .filter(pid => Number.isInteger(pid) && pid > 0 && isAlive(pid));
}

function findHermesPids() {
  if (process.platform !== 'win32') {
    return [];
  }

  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      [
        "$items = Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\"",
        `$items | Where-Object { $_.CommandLine -like '*hermes-bot.js*' -and $_.ProcessId -ne ${process.pid} } | ForEach-Object { $_.ProcessId }`,
      ].join('; '),
    ],
    { encoding: 'utf8' },
  );

  return result.stdout
    .split(/\s+/)
    .map(value => Number(value.trim()))
    .filter(pid => Number.isInteger(pid) && pid > 0 && isAlive(pid));
}

function findHermesSupervisorPids() {
  if (process.platform !== 'win32') {
    return [];
  }

  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      [
        "$items = Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\"",
        `$items | Where-Object { $_.CommandLine -like '*hermes-supervisor.mjs*' -and $_.ProcessId -ne ${process.pid} } | ForEach-Object { $_.ProcessId }`,
      ].join('; '),
    ],
    { encoding: 'utf8' },
  );

  return result.stdout
    .split(/\s+/)
    .map(value => Number(value.trim()))
    .filter(pid => Number.isInteger(pid) && pid > 0 && isAlive(pid));
}

function stopProcessTree(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
    });
    return;
  }

  process.kill(pid, 'SIGTERM');
}

function psSingleQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function vbsQuote(value) {
  return String(value).replaceAll('"', '""');
}

function getStartupFilePath() {
  const appData = process.env.APPDATA;
  if (!appData) {
    throw new Error('APPDATA is not set; cannot locate Startup folder.');
  }

  return path.join(
    appData,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
    startupFileName,
  );
}

function getAutostartCommand() {
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${launcherScript}"`;
}

function runPowerShell(commandText) {
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', commandText],
    { encoding: 'utf8' },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim());
  }

  return result.stdout.trim();
}

function startWindowsDetachedProcess() {
  const commandText = [
    '$ErrorActionPreference = "Stop"',
    '$env:TELEGRAM_BOT_MODE = "polling"',
    `$p = Start-Process -FilePath ${psSingleQuote(
      process.execPath,
    )} -ArgumentList @(${psSingleQuote(
      watchdogScript,
    )}) -WorkingDirectory ${psSingleQuote(
      rootDir,
    )} -WindowStyle Hidden -PassThru`,
    '$p.Id',
  ].join('; ');

  const stdout = runPowerShell(commandText);
  const pid = Number(stdout.split(/\s+/).at(-1));
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Failed to read Hermes watchdog PID: ${stdout}`);
  }

  return pid;
}

function startDetachedProcess() {
  if (process.platform === 'win32') {
    return startWindowsDetachedProcess();
  }

  const out = openSync(outLog, 'a');
  const err = openSync(errLog, 'a');
  const child = spawn(process.execPath, [watchdogScript], {
    cwd: rootDir,
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: true,
    env: {
      ...process.env,
      TELEGRAM_BOT_MODE: 'polling',
    },
  });

  child.unref();
  return child.pid;
}

async function wait(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function tail(filePath, maxChars = 2000) {
  try {
    const text = await readFile(filePath, 'utf8');
    return text.slice(-maxChars);
  } catch {
    return '';
  }
}

async function readState() {
  try {
    return JSON.parse(await readFile(serviceStatePath, 'utf8'));
  } catch {
    return {};
  }
}

async function telegram(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const response = await fetchWithRetry(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
    5,
  );
  const payload = await response.json();

  if (!payload.ok) {
    throw new Error(payload.description || `${method} failed`);
  }

  return payload.result;
}

async function checkTelegram({ fix = false } = {}) {
  const me = await telegram('getMe');
  const webhook = await telegram('getWebhookInfo');

  if (fix && webhook.url) {
    await telegram('deleteWebhook', { drop_pending_updates: false });
  }

  return {
    username: me.username,
    firstName: me.first_name,
    webhookUrl: webhook.url || '',
    pendingUpdates: webhook.pending_update_count || 0,
    lastError: webhook.last_error_message || '',
  };
}

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastError = null;
  const timeoutMs = Number(process.env.HERMES_FETCH_TIMEOUT_MS || 20000);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      lastError = error;

      if (attempt >= attempts) {
        break;
      }

      await wait(1000 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

async function checkDeepSeek() {
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro';
  const baseUrl = (
    process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  ).replace(/\/+$/, '');
  const response = await fetchWithRetry(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'Ты Гермес, дружелюбный Telegram-помощник. Гермес - это имя продукта, не роль. Ответь одним коротким русским предложением. Не называй себя Claude и не отыгрывай мифологического персонажа.',
          },
          { role: 'user', content: 'Проверка связи.' },
        ],
        max_tokens: 500,
      }),
    },
  );
  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(payload?.error?.message || text);
  }

  const content = payload?.choices?.[0]?.message?.content?.trim();
  const reasoningLength =
    payload?.choices?.[0]?.message?.reasoning_content?.length || 0;

  return {
    model,
    content: content || '',
    reasoningLength,
  };
}

function getTaskSummary() {
  if (process.platform !== 'win32') {
    return 'Windows Task Scheduler is only available on Windows.';
  }

  try {
    const startupFile = getStartupFilePath();
    return (
      runPowerShell(
        [
          `$taskName = ${psSingleQuote(taskName)}`,
          `$runName = ${psSingleQuote(taskName)}`,
          `$startupFile = ${psSingleQuote(startupFile)}`,
          '$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue',
          'if ($task) { $info = Get-ScheduledTaskInfo -TaskName $taskName; "Scheduled task: installed"; "Task state: $($task.State)"; "Task last run: $($info.LastRunTime)"; "Task last result: $($info.LastTaskResult)"; "Task next run: $($info.NextRunTime)" } else { "Scheduled task: not installed" }',
          '$runValue = Get-ItemPropertyValue -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" -Name $runName -ErrorAction SilentlyContinue',
          'if ($runValue) { "HKCU Run: installed" } else { "HKCU Run: not installed" }',
          'if (Test-Path $startupFile) { "Startup file: installed" } else { "Startup file: not installed" }',
        ].join('; '),
      ) || 'No autostart data'
    );
  } catch (error) {
    return `Unavailable: ${error.message}`;
  }
}

async function doctor() {
  const fix = process.argv.includes('--fix');

  console.log('Environment');
  console.log(`TELEGRAM_BOT_TOKEN: ${maskStatus('TELEGRAM_BOT_TOKEN')}`);
  console.log(`DEEPSEEK_API_KEY: ${maskStatus('DEEPSEEK_API_KEY')}`);
  console.log(
    `DEEPSEEK_MODEL: ${
      process.env.DEEPSEEK_MODEL || '(default deepseek-v4-pro)'
    }`,
  );
  console.log(
    `DEEPSEEK_BASE_URL: ${
      process.env.DEEPSEEK_BASE_URL || '(default https://api.deepseek.com)'
    }`,
  );

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.DEEPSEEK_API_KEY) {
    process.exitCode = 1;
    return;
  }

  const telegramStatus = await checkTelegram({ fix });
  console.log('\nTelegram');
  console.log(`Bot: @${telegramStatus.username} (${telegramStatus.firstName})`);
  console.log(`Webhook: ${telegramStatus.webhookUrl || 'empty'}`);
  console.log(`Pending updates: ${telegramStatus.pendingUpdates}`);
  if (telegramStatus.lastError) {
    console.log(`Webhook last error: ${telegramStatus.lastError}`);
  }

  const deepSeekStatus = await checkDeepSeek();
  console.log('\nDeepSeek');
  console.log(`Model: ${deepSeekStatus.model}`);
  console.log(`Answer: ${deepSeekStatus.content || '(empty final content)'}`);
  if (deepSeekStatus.reasoningLength) {
    console.log(`Reasoning chars: ${deepSeekStatus.reasoningLength}`);
  }

  const watchdogPid = await readPid(watchdogPidPath);
  const supervisorPid = await readPid(supervisorPidPath);
  const botPid = await readPid(botPidPath);
  const state = await readState();
  console.log('\nProcess');
  console.log(
    watchdogPid && isAlive(watchdogPid)
      ? `Watchdog: running ${watchdogPid}`
      : 'Watchdog: stopped',
  );
  console.log(
    supervisorPid && isAlive(supervisorPid)
      ? `Supervisor: running ${supervisorPid}`
      : 'Supervisor: stopped',
  );
  console.log(botPid && isAlive(botPid) ? `Bot: running ${botPid}` : 'Bot: stopped');
  if (state.restarts) {
    console.log(`Restarts: ${state.restarts}`);
  }

  console.log('\nWindows Task');
  console.log(getTaskSummary());
}

async function status() {
  const watchdogPid = await readPid(watchdogPidPath);
  const supervisorPid = await readPid(supervisorPidPath);
  const botPid = await readPid(botPidPath);

  if (watchdogPid && isAlive(watchdogPid)) {
    const supervisorStatus =
      supervisorPid && isAlive(supervisorPid)
        ? ` Supervisor PID: ${supervisorPid}.`
        : '';
    const botStatus = botPid && isAlive(botPid) ? ` Bot PID: ${botPid}.` : '';
    console.log(
      `Hermes watchdog is running. PID: ${watchdogPid}.${supervisorStatus}${botStatus}`,
    );
    return;
  }

  const runningWatchdogs = findHermesWatchdogPids();
  if (runningWatchdogs.length) {
    await writeFile(watchdogPidPath, String(runningWatchdogs[0]), 'utf8');
    console.log(`Hermes watchdog is running. PID: ${runningWatchdogs[0]}`);
    return;
  }

  if (supervisorPid && isAlive(supervisorPid)) {
    const botStatus = botPid && isAlive(botPid) ? ` Bot PID: ${botPid}.` : '';
    console.log(
      `Hermes supervisor is running without watchdog. PID: ${supervisorPid}.${botStatus}`,
    );
    return;
  }

  const runningSupervisors = findHermesSupervisorPids();
  if (runningSupervisors.length) {
    await writeFile(supervisorPidPath, String(runningSupervisors[0]), 'utf8');
    console.log(`Hermes supervisor is running. PID: ${runningSupervisors[0]}`);
    return;
  }

  const runningBots = findHermesPids();
  if (runningBots.length) {
    console.log(
      `Hermes bot process is running without supervisor. PID: ${runningBots[0]}`,
    );
    return;
  }

  console.log('Hermes bot is not running.');
}

async function start() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  const existingWatchdogPid = await readPid(watchdogPidPath);
  if (existingWatchdogPid && isAlive(existingWatchdogPid)) {
    const supervisorPid = await readPid(supervisorPidPath);
    const botPid = await readPid(botPidPath);
    const supervisorStatus =
      supervisorPid && isAlive(supervisorPid)
        ? ` Supervisor PID: ${supervisorPid}.`
        : '';
    const botStatus = botPid && isAlive(botPid) ? ` Bot PID: ${botPid}.` : '';
    console.log(
      `Hermes watchdog is already running. PID: ${existingWatchdogPid}.${supervisorStatus}${botStatus}`,
    );
    return;
  }

  const runningWatchdogs = findHermesWatchdogPids();
  if (runningWatchdogs.length) {
    await writeFile(watchdogPidPath, String(runningWatchdogs[0]), 'utf8');
    console.log(
      `Hermes watchdog is already running. PID: ${runningWatchdogs[0]}`,
    );
    return;
  }

  const existingSupervisorPid = await readPid(supervisorPidPath);
  if (existingSupervisorPid && isAlive(existingSupervisorPid)) {
    stopProcessTree(existingSupervisorPid);
  }

  const runningSupervisors = findHermesSupervisorPids();
  for (const oldSupervisorPid of runningSupervisors) {
    stopProcessTree(oldSupervisorPid);
  }

  for (const oldBotPid of findHermesPids()) {
    stopProcessTree(oldBotPid);
  }
  await rm(watchdogPidPath, { force: true });
  await rm(supervisorPidPath, { force: true });
  await rm(botPidPath, { force: true });

  const pid = startDetachedProcess();
  await writeFile(watchdogPidPath, String(pid), 'utf8');
  const startedAt = Date.now();
  const deadline = Date.now() + 30000;
  let supervisorPid = null;
  let botPid = null;

  while (Date.now() < deadline) {
    await wait(1000);

    if (!isAlive(pid)) {
      console.log(`Hermes watchdog failed to stay alive. Check ${errLog}`);
      const errorTail = await tail(errLog);
      if (errorTail) {
        console.log(errorTail);
      }
      process.exitCode = 1;
      return;
    }

    supervisorPid = await readPid(supervisorPidPath);
    botPid = await readPid(botPidPath);
    if (
      supervisorPid &&
      isAlive(supervisorPid) &&
      botPid &&
      isAlive(botPid) &&
      Date.now() - startedAt >= 12000
    ) {
      break;
    }
  }

  supervisorPid = supervisorPid || (await readPid(supervisorPidPath));
  botPid = botPid || (await readPid(botPidPath));
  if (
    !supervisorPid ||
    !isAlive(supervisorPid) ||
    !botPid ||
    !isAlive(botPid)
  ) {
    console.log(`Hermes watchdog started but bot stack is not fully alive yet.`);
    const errorTail = await tail(errLog);
    if (errorTail) {
      console.log(errorTail);
    }
    process.exitCode = 1;
    return;
  }

  await writeFile(
    serviceStatePath,
    JSON.stringify(
      {
        mode: 'polling',
        watchdogPid: pid,
        supervisorPid,
        botPid,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(
    `Hermes watchdog started in polling mode. PID: ${pid}. Supervisor PID: ${supervisorPid}. Bot PID: ${botPid}`,
  );
  console.log(`Logs: ${outLog}`);
}

async function stop() {
  const watchdogPid = await readPid(watchdogPidPath);
  const supervisorPid = await readPid(supervisorPidPath);

  if (
    watchdogPid &&
    isAlive(watchdogPid) &&
    process.platform === 'win32' &&
    !isHermesProcess(watchdogPid)
  ) {
    console.log(
      `PID ${watchdogPid} is alive but does not look like Hermes. Leaving it untouched.`,
    );
    process.exitCode = 1;
    return;
  }

  if (watchdogPid && isAlive(watchdogPid)) {
    stopProcessTree(watchdogPid);
  }

  if (supervisorPid && isAlive(supervisorPid)) {
    stopProcessTree(supervisorPid);
  }

  for (const oldWatchdogPid of findHermesWatchdogPids()) {
    stopProcessTree(oldWatchdogPid);
  }

  for (const oldSupervisorPid of findHermesSupervisorPids()) {
    stopProcessTree(oldSupervisorPid);
  }

  for (const botPid of findHermesPids()) {
    stopProcessTree(botPid);
  }

  await wait(1200);
  await telegram('deleteWebhook', { drop_pending_updates: false }).catch(
    () => {},
  );
  await rm(watchdogPidPath, { force: true });
  await rm(supervisorPidPath, { force: true });
  await rm(botPidPath, { force: true });
  await rm(serviceStatePath, { force: true });
  console.log(
    watchdogPid
      ? `Hermes watchdog stopped. PID: ${watchdogPid}`
      : 'Hermes bot is not running.',
  );
}

async function installUserAutostart() {
  const startupFile = getStartupFilePath();
  const autostartCommand = getAutostartCommand();

  await mkdir(path.dirname(startupFile), { recursive: true });
  await writeFile(
    startupFile,
    [
      'Set WshShell = CreateObject("WScript.Shell")',
      `WshShell.Run "${vbsQuote(autostartCommand)}", 0, False`,
      '',
    ].join('\r\n'),
    'utf8',
  );

  runPowerShell(
    [
      '$ErrorActionPreference = "Stop"',
      '$runPath = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"',
      `$runName = ${psSingleQuote(taskName)}`,
      `$runValue = ${psSingleQuote(autostartCommand)}`,
      'New-Item -Path $runPath -Force | Out-Null',
      'New-ItemProperty -Path $runPath -Name $runName -Value $runValue -PropertyType String -Force | Out-Null',
    ].join('; '),
  );

  runPowerShell(
    [
      '$ErrorActionPreference = "Stop"',
      `Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", ${psSingleQuote(
        launcherScript,
      )}) -WindowStyle Hidden`,
    ].join('; '),
  );

  await wait(6000);
}

async function installTask() {
  if (process.platform !== 'win32') {
    console.log('Windows Task Scheduler install is only available on Windows.');
    process.exitCode = 1;
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  try {
    runPowerShell(
      [
        '$ErrorActionPreference = "Stop"',
        `$taskName = ${psSingleQuote(taskName)}`,
        `$node = ${psSingleQuote(process.execPath)}`,
        `$script = ${psSingleQuote(watchdogScript)}`,
        `$root = ${psSingleQuote(rootDir)}`,
        '$action = New-ScheduledTaskAction -Execute $node -Argument $script -WorkingDirectory $root',
        '$logonTrigger = New-ScheduledTaskTrigger -AtLogOn',
        '$repeatTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)',
        '$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew',
        '$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name',
        '$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited',
        'Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logonTrigger, $repeatTrigger) -Settings $settings -Principal $principal -Force | Out-Null',
        'Start-ScheduledTask -TaskName $taskName',
      ].join('; '),
    );
    console.log(`Windows scheduled task installed: ${taskName}`);
  } catch (error) {
    console.log(
      `Windows scheduled task was not installed: ${error.message.split('\n')[0]}`,
    );
    console.log('Using user autostart fallback instead.');
  }

  await installUserAutostart();
  console.log(`Windows user autostart installed: ${taskName}`);
  console.log(getTaskSummary());
}

async function uninstallTask() {
  if (process.platform !== 'win32') {
    console.log('Windows Task Scheduler uninstall is only available on Windows.');
    process.exitCode = 1;
    return;
  }

  const startupFile = getStartupFilePath();

  runPowerShell(
    [
      `$taskName = ${psSingleQuote(taskName)}`,
      '$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue',
      'if ($task) { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }',
      '$runPath = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"',
      '$runName = $taskName',
      'Remove-ItemProperty -Path $runPath -Name $runName -ErrorAction SilentlyContinue',
    ].join('; '),
  );
  await rm(startupFile, { force: true });
  console.log(`Windows task removed: ${taskName}`);
}

async function taskStatus() {
  console.log(getTaskSummary());
}

try {
  if (command === 'doctor') {
    await doctor();
  } else if (command === 'start') {
    await start();
  } else if (command === 'stop') {
    await stop();
  } else if (command === 'status') {
    await status();
  } else if (command === 'install-task') {
    await installTask();
  } else if (command === 'uninstall-task') {
    await uninstallTask();
  } else if (command === 'task-status') {
    await taskStatus();
  } else {
    console.log(
      'Usage: node scripts/hermes-service.mjs <doctor|start|stop|status|install-task|uninstall-task|task-status>',
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
