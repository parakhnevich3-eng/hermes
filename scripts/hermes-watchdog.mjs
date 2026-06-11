import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const dataDir = path.join(rootDir, 'data');
const logsDir = path.join(rootDir, 'logs');
const supervisorScript = path.join(rootDir, 'scripts', 'hermes-supervisor.mjs');
const watchdogPidPath = path.join(dataDir, 'hermes-watchdog.pid');
const supervisorPidPath = path.join(dataDir, 'hermes-supervisor.pid');
const outLog = path.join(logsDir, 'hermes-bot.out.log');
const errLog = path.join(logsDir, 'hermes-bot.err.log');
let stopping = false;

mkdirSync(dataDir, { recursive: true });
mkdirSync(logsDir, { recursive: true });
writeFileSync(watchdogPidPath, String(process.pid), 'utf8');
logOut(`Hermes watchdog started. PID: ${process.pid}`);

function timestamp() {
  return new Date().toISOString();
}

function append(filePath, message) {
  appendFileSync(filePath, `[${timestamp()}] ${message}\n`, 'utf8');
}

function logOut(message) {
  append(outLog, message);
}

function logErr(message, error) {
  const details = error?.stack || error?.message || error || '';
  append(errLog, details ? `${message}\n${details}` : message);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findSupervisorPids() {
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

function startSupervisor() {
  const child = spawn(process.execPath, [supervisorScript], {
    cwd: rootDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      TELEGRAM_BOT_MODE: 'polling',
    },
  });

  child.unref();
  writeFileSync(supervisorPidPath, String(child.pid), 'utf8');
  logOut(`Hermes watchdog started supervisor. PID: ${child.pid}`);
  return child.pid;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loop() {
  while (!stopping) {
    try {
      const supervisorPids = findSupervisorPids();

      if (supervisorPids.length) {
        writeFileSync(supervisorPidPath, String(supervisorPids[0]), 'utf8');
      } else {
        logErr('Hermes supervisor is missing. Watchdog will restart it.');
        startSupervisor();
      }
    } catch (error) {
      logErr('Hermes watchdog loop failed.', error);
    }

    await delay(30000);
  }
}

function stop(reason) {
  if (stopping) {
    return;
  }

  stopping = true;
  logOut(`Hermes watchdog stopping: ${reason}`);
  rmSync(watchdogPidPath, { force: true });
  setTimeout(() => process.exit(0), 500).unref();
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
process.on('uncaughtException', error => {
  logErr('Hermes watchdog uncaught exception.', error);
});
process.on('unhandledRejection', error => {
  logErr('Hermes watchdog unhandled rejection.', error);
});
process.on('exit', code => {
  append(outLog, `Hermes watchdog exited. PID: ${process.pid}, code: ${code}`);
});

loop();
