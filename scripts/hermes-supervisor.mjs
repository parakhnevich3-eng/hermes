import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const dataDir = path.join(rootDir, 'data');
const logsDir = path.join(rootDir, 'logs');
const botScript = path.join(rootDir, 'bot', 'hermes-bot.js');
const supervisorPidPath = path.join(dataDir, 'hermes-supervisor.pid');
const botPidPath = path.join(dataDir, 'hermes-bot.pid');
const statePath = path.join(dataDir, 'hermes-service.json');
const outLog = path.join(logsDir, 'hermes-bot.out.log');
const errLog = path.join(logsDir, 'hermes-bot.err.log');
let botProcess = null;
let stopping = false;
let restartCount = 0;
let lastStartAt = 0;

dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });
mkdirSync(dataDir, { recursive: true });
mkdirSync(logsDir, { recursive: true });
writeFileSync(supervisorPidPath, String(process.pid), 'utf8');
logOut(`Hermes supervisor started. PID: ${process.pid}`);

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

function writeState(extra = {}) {
  writeFileSync(
    statePath,
    JSON.stringify(
      {
        mode: 'polling',
        supervisorPid: process.pid,
        botPid: botProcess?.pid || null,
        restarts: restartCount,
        updatedAt: timestamp(),
        ...extra,
      },
      null,
      2,
    ),
    'utf8',
  );
}

function startBot() {
  lastStartAt = Date.now();
  botProcess = spawn(process.execPath, [botScript], {
    cwd: rootDir,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      TELEGRAM_BOT_MODE: 'polling',
      HERMES_LOG_TO_FILES: '1',
    },
  });

  writeFileSync(botPidPath, String(botProcess.pid), 'utf8');
  writeState({ startedAt: timestamp() });
  logOut(`Hermes bot child started. PID: ${botProcess.pid}`);

  botProcess.on('exit', (code, signal) => {
    const uptimeMs = Date.now() - lastStartAt;
    const pid = botProcess?.pid;
    botProcess = null;
    rmSync(botPidPath, { force: true });

    if (stopping) {
      logOut(
        `Hermes bot child stopped. PID: ${pid}, code: ${code}, signal: ${
          signal || 'none'
        }`,
      );
      return;
    }

    restartCount += 1;
    writeState({
      lastExit: {
        code,
        signal,
        uptimeMs,
        at: timestamp(),
      },
    });
    logErr(
      `Hermes bot child exited unexpectedly. PID: ${pid}, code: ${code}, signal: ${
        signal || 'none'
      }, uptimeMs: ${uptimeMs}. Restart #${restartCount} scheduled.`,
    );

    const restartDelay = uptimeMs < 10000 ? 15000 : 3000;
    setTimeout(() => {
      if (!stopping) {
        startBot();
      }
    }, restartDelay);
  });

  botProcess.on('error', error => {
    logErr('Failed to spawn Hermes bot child.', error);
  });
}

function stop(reason) {
  if (stopping) {
    return;
  }

  stopping = true;
  logOut(`Hermes supervisor stopping: ${reason}`);
  writeState({ stopping: true, stopReason: reason });

  if (botProcess && !botProcess.killed) {
    botProcess.kill('SIGTERM');
  }

  setTimeout(() => {
    rmSync(supervisorPidPath, { force: true });
    rmSync(botPidPath, { force: true });
    process.exit(0);
  }, 2500).unref();
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
process.on('uncaughtException', error => {
  logErr('Hermes supervisor uncaught exception.', error);
});
process.on('unhandledRejection', error => {
  logErr('Hermes supervisor unhandled rejection.', error);
});
process.on('exit', code => {
  append(
    outLog,
    `Hermes supervisor exited. PID: ${process.pid}, code: ${code}`,
  );
});

startBot();
