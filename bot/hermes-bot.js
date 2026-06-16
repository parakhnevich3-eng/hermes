require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const https = require('https');
const { inspect } = require('util');
const { Telegraf } = require('telegraf');
const { countWords, truncateToWords, parseDocument } = require('./document-utils');

const token = process.env.TELEGRAM_BOT_TOKEN;
const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
const deepseekModel = process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro';
const deepseekBaseUrl = (
  process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
).replace(/\/+$/, '');
const perplexityApiKey = process.env.PERPLEXITY_API_KEY;
const perplexityModel = process.env.PERPLEXITY_MODEL || 'sonar-pro';
const perplexityBaseUrl = 'https://api.perplexity.ai';
const openrouterApiKey = process.env.OPENROUTER_API_KEY;
const openrouterModel    = process.env.OPENROUTER_MODEL    || 'deepseek/deepseek-v4-pro';
const minimaxModel       = process.env.MINIMAX_MODEL       || 'minimax/minimax-01';
const claudeModel        = process.env.CLAUDE_MODEL        || 'anthropic/claude-sonnet-4-5';
const geminiModel        = process.env.GEMINI_MODEL        || 'google/gemini-2.5-pro-preview';
const grokModel          = process.env.GROK_MODEL          || 'x-ai/grok-3';
const qwenCoderModel     = process.env.QWEN_CODER_MODEL    || 'qwen/qwen-2.5-coder-32b-instruct';
const deepseekR1Model    = process.env.DEEPSEEK_R1_MODEL   || 'deepseek/deepseek-r1';
const openrouterBaseUrl  = 'https://openrouter.ai/api/v1';
const replicateApiKey  = process.env.REPLICATE_API_KEY;
const imageModel       = process.env.IMAGE_MODEL   || 'black-forest-labs/flux-1.1-pro-ultra';
const videoModel       = process.env.VIDEO_MODEL   || 'minimax/video-01';
const animateModel     = process.env.ANIMATE_MODEL || 'luma/ray-3.2';
const voiceModel       = process.env.VOICE_MODEL   || 'vaibhavs10/incredibly-fast-whisper';
const replicateBaseUrl = 'https://api.replicate.com/v1';
const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;
const firecrawlBaseUrl = 'https://api.firecrawl.dev';
const githubToken = process.env.GITHUB_TOKEN;
const githubBaseUrl = 'https://api.github.com';
const vercelToken = process.env.VERCEL_API_TOKEN;
const vercelTeamId = process.env.VERCEL_TEAM_ID;
const vercelBaseUrl = 'https://api.vercel.com';
const deepseekThinkingEnabled = ['1', 'true', 'yes'].includes(
  (process.env.DEEPSEEK_THINKING || '').toLowerCase(),
);
const deepseekMaxAttempts = Math.max(
  1,
  Number(process.env.DEEPSEEK_RETRIES || 3),
);
const allowedUserIds = (process.env.TELEGRAM_ALLOWED_USER_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);
const histories = new Map();
const onboardingStates = new Map();
const chatProviders = new Map();
const chatAutoMode = new Map();
const lastPhotos = new Map(); // chatId → photo array (last received)
const docContexts = new Map(); // chatId → { text, fileName }
const telegramOutbox = [];
let telegramOutboxTimer = null;
const maxHistoryMessages = 12;
const telegramMessageLimit = 3900;
const telegramDeliveryAttempts = Math.max(
  1,
  Number(process.env.TELEGRAM_DELIVERY_RETRIES || 6),
);
const telegramOutboxMaxAttempts = Math.max(
  telegramDeliveryAttempts,
  Number(process.env.TELEGRAM_OUTBOX_RETRIES || 60),
);
const PRICING = {
  perplexity: {
    'sonar':              { input: 1e-6,    output: 1e-6,   search: 5e-3 },
    'sonar-pro':          { input: 3e-6,    output: 15e-6,  search: 5e-3 },
    'sonar-reasoning':    { input: 1e-6,    output: 5e-6,   search: 5e-3 },
    'sonar-reasoning-pro':{ input: 2e-6,    output: 8e-6,   search: 5e-3 },
  },
  deepseek: {
    'deepseek-chat':      { input: 0.27e-6, output: 1.10e-6 },
    'deepseek-reasoner':  { input: 0.55e-6, output: 2.19e-6 },
    'deepseek-v3':        { input: 0.27e-6, output: 1.10e-6 },
    'deepseek-v4-pro':    { input: 0.27e-6, output: 1.10e-6 },
  },
  openrouter: {
    'deepseek/deepseek-v4-pro':             { input: 0.27e-6, output: 1.10e-6 },
    'nousresearch/hermes-3-llama-3.1-405b': { input: 0.8e-6,  output: 0.8e-6  },
    'nousresearch/hermes-3-llama-3.1-70b':  { input: 0.1e-6,  output: 0.1e-6  },
  },
  minimax: {
    'minimax/minimax-01':      { input: 0.2e-6,  output: 1.1e-6  },
    'minimax/minimax-text-01': { input: 0.2e-6,  output: 1.1e-6  },
  },
  claude: {
    'anthropic/claude-sonnet-4-5': { input: 3e-6,   output: 15e-6  },
    'anthropic/claude-opus-4':     { input: 15e-6,  output: 75e-6  },
    'anthropic/claude-haiku-4-5':  { input: 0.8e-6, output: 4e-6   },
  },
  gemini: {
    'google/gemini-3.5-flash-20260519': { input: 0.15e-6, output: 0.6e-6 },
  },
  grok: {
    'x-ai/grok-4.20-20260309': { input: 3e-6, output: 15e-6 },
  },
  'qwen-coder': {
    'qwen/qwen3.5-plus-20260420': { input: 0.5e-6, output: 1.5e-6 },
  },
  'deepseek-r1': {
    'qwen/qwen3.7-max': { input: 1.0e-6, output: 3.0e-6 },
  },
};
const dataDir = path.join(__dirname, '..', 'data');
const logsDir = path.join(__dirname, '..', 'logs');
const profilesPath = path.join(dataDir, 'onboarding.json');
const outboxPath = path.join(dataDir, 'telegram-outbox.json');
const spendingPath = path.join(dataDir, 'spending.json');
configureFileLogging();
const profiles = loadProfiles();
loadTelegramOutbox();
const spending = loadSpending();
let shuttingDown = false;
const defaultProvider = openrouterApiKey ? 'openrouter' : 'deepseek';

function getChatProvider(chatId) {
  return chatProviders.get(chatId) || defaultProvider;
}

function setChatProvider(chatId, provider) {
  chatProviders.set(chatId, provider);
}

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set.');
  console.error(
    'Create .env from .env.example and put your BotFather token there.',
  );
  process.exit(1);
}

if (!deepseekApiKey) {
  console.error('DEEPSEEK_API_KEY is not set.');
  console.error(
    'Create .env from .env.example and put your DeepSeek API key there.',
  );
  process.exit(1);
}

const bot = new Telegraf(token);

function configureFileLogging() {
  const enabled = ['1', 'true', 'yes'].includes(
    (process.env.HERMES_LOG_TO_FILES || '').toLowerCase(),
  );

  if (!enabled) {
    return;
  }

  fs.mkdirSync(logsDir, { recursive: true });
  const out = fs.createWriteStream(path.join(logsDir, 'hermes-bot.out.log'), {
    flags: 'a',
  });
  const err = fs.createWriteStream(path.join(logsDir, 'hermes-bot.err.log'), {
    flags: 'a',
  });
  const originalLog = console.log.bind(console);
  const originalError = console.error.bind(console);

  console.log = (...args) => {
    const line = formatConsoleArgs(args);
    originalLog(line);
    out.write(`${line}\n`);
  };

  console.error = (...args) => {
    const line = formatConsoleArgs(args);
    originalError(line);
    err.write(`${line}\n`);
  };
}

function formatConsoleArgs(args) {
  const text = args
    .map(value =>
      typeof value === 'string'
        ? value
        : inspect(value, { breakLength: 120, depth: 6 }),
    )
    .join(' ');

  return redactSecrets(text);
}

function redactSecrets(text) {
  let redacted = text;

  for (const secret of [token, deepseekApiKey, perplexityApiKey, githubToken]) {
    if (secret) {
      redacted = redacted.replaceAll(secret, '[REDACTED]');
    }
  }

  redacted = redacted.replace(
    /bot\d+:[A-Za-z0-9_-]+/g,
    'bot[REDACTED]',
  );

  return redacted;
}

function loadProfiles() {
  try {
    if (!fs.existsSync(profilesPath)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
  } catch (error) {
    console.error('Failed to load onboarding profiles:', error);
    return {};
  }
}

function saveProfiles() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2));
}

function loadTelegramOutbox() {
  try {
    if (!fs.existsSync(outboxPath)) {
      return;
    }

    const loaded = JSON.parse(fs.readFileSync(outboxPath, 'utf8'));
    if (Array.isArray(loaded)) {
      telegramOutbox.push(...loaded);
    }
  } catch (error) {
    console.error('Failed to load Telegram outbox:', error);
  }
}

function loadSpending() {
  try {
    if (!fs.existsSync(spendingPath)) {
      return { total_usd: 0, requests: 0, by_model: {} };
    }
    return JSON.parse(fs.readFileSync(spendingPath, 'utf8'));
  } catch {
    return { total_usd: 0, requests: 0, by_model: {} };
  }
}

function saveSpending() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(spendingPath, JSON.stringify(spending, null, 2));
  } catch (error) {
    console.error('Failed to save spending:', error);
  }
}

function recordSpend(provider, model, inputTokens, outputTokens, costUsd) {
  const key = `${provider}/${model}`;
  spending.total_usd = (spending.total_usd || 0) + costUsd;
  spending.requests = (spending.requests || 0) + 1;

  if (!spending.by_model[key]) {
    spending.by_model[key] = { requests: 0, total_usd: 0, input_tokens: 0, output_tokens: 0 };
  }

  spending.by_model[key].requests += 1;
  spending.by_model[key].total_usd += costUsd;
  spending.by_model[key].input_tokens += inputTokens;
  spending.by_model[key].output_tokens += outputTokens;
  saveSpending();
}

function calcCost(provider, model, inputTokens, outputTokens) {
  const lm = model.toLowerCase();
  const table = PRICING[provider] || {};
  const pricing = table[lm] || Object.entries(table).find(([k]) => lm.includes(k))?.[1];

  if (!pricing) return null;

  let cost = inputTokens * pricing.input + outputTokens * pricing.output;
  if (provider === 'perplexity' && pricing.search) cost += pricing.search;
  return cost;
}

function buildCostFooter(provider, model, inputTokens, outputTokens, costUsd) {
  const costStr = costUsd != null ? `~$${costUsd.toFixed(5)}` : '?';
  const totalStr = `$${(spending.total_usd || 0).toFixed(4)}`;
  return `\n─────\n${provider}/${model} · ${inputTokens}→${outputTokens} tok · ${costStr} · итого ${totalStr}`;
}

function saveTelegramOutbox() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(outboxPath, JSON.stringify(telegramOutbox, null, 2));
}

function enqueueTelegramMessage(chatId, text, extra, error) {
  telegramOutbox.push({
    chatId,
    text,
    extra: extra || {},
    attempts: 0,
    createdAt: new Date().toISOString(),
    nextAt: Date.now() + 15000,
    lastError: error?.message || String(error || ''),
  });
  saveTelegramOutbox();
  ensureTelegramOutboxWorker();
}

function ensureTelegramOutboxWorker() {
  if (telegramOutboxTimer) {
    return;
  }

  telegramOutboxTimer = setInterval(processTelegramOutbox, 10000);
  telegramOutboxTimer.unref?.();
}

async function processTelegramOutbox() {
  if (!telegramOutbox.length || shuttingDown) {
    return;
  }

  const now = Date.now();
  const item = telegramOutbox[0];

  if (item.nextAt > now) {
    return;
  }

  try {
    await bot.telegram.sendMessage(item.chatId, item.text, item.extra || {});
    telegramOutbox.shift();
    saveTelegramOutbox();
  } catch (error) {
    item.attempts += 1;
    item.lastError = error?.message || String(error);
    item.nextAt = Date.now() + Math.min(300000, 15000 * item.attempts);

    if (item.attempts >= telegramOutboxMaxAttempts) {
      console.error('Telegram outbox message expired:', error);
      telegramOutbox.shift();
    } else {
      console.error(
        `Telegram outbox send failed, will retry (${item.attempts}/${telegramOutboxMaxAttempts}):`,
        error,
      );
    }

    saveTelegramOutbox();
  }
}

async function telegramCallWithRetry(label, action, attempts) {
  let lastError = null;
  const maxAttempts = attempts || telegramDeliveryAttempts;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts || !isTransientTelegramError(error)) {
        break;
      }

      console.error(
        `${label} failed, retrying (${attempt}/${maxAttempts}):`,
        error,
      );
      await delay(Math.min(30000, 1000 * 2 ** (attempt - 1)));
    }
  }

  throw lastError;
}

function isTransientTelegramError(error) {
  const code = error?.code || error?.errno;
  const statusCode = error?.response?.error_code;

  return (
    ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND'].includes(
      code,
    ) ||
    statusCode === 429 ||
    statusCode >= 500
  );
}

async function reply(ctx, text, extra) {
  const chatId = ctx.chat?.id;

  if (!chatId) {
    return null;
  }

  try {
    return await telegramCallWithRetry('Telegram sendMessage', () =>
      bot.telegram.sendMessage(chatId, text, extra),
    );
  } catch (error) {
    enqueueTelegramMessage(chatId, text, extra, error);
    console.error('Telegram sendMessage failed; message queued:', error);
    return null;
  }
}

async function sendChatAction(ctx, action) {
  const chatId = ctx.chat?.id;

  if (!chatId) {
    return null;
  }

  try {
    return await telegramCallWithRetry(
      'Telegram sendChatAction',
      () => bot.telegram.sendChatAction(chatId, action),
      3,
    );
  } catch (error) {
    console.error('Telegram sendChatAction failed:', error);
    return null;
  }
}

async function answerCallback(ctx) {
  try {
    await telegramCallWithRetry(
      'Telegram answerCallbackQuery',
      () => ctx.answerCbQuery(),
      3,
    );
  } catch (error) {
    console.error('Telegram answerCallbackQuery failed:', error);
  }
}

function getProfile(chatId) {
  return profiles[String(chatId)] || null;
}

function saveProfile(chatId, profile) {
  profiles[String(chatId)] = {
    ...getProfile(chatId),
    ...profile,
    updatedAt: new Date().toISOString(),
  };
  saveProfiles();
}

function buildSystemPrompt(chatId) {
  const provider = getChatProvider(chatId);
  const identity =
    provider === 'perplexity'
      ? `Я работаю через Perplexity AI API, модель: ${perplexityModel}. Я не Claude и не модель Anthropic.`
      : provider === 'openrouter'
        ? `Я работаю через OpenRouter API, модель: ${openrouterModel}. Я не Claude и не модель Anthropic.`
        : provider === 'minimax'      ? `Я работаю через OpenRouter API, модель: ${minimaxModel}.`
        : provider === 'claude'       ? `Я работаю через OpenRouter API, модель: ${claudeModel}.`
        : provider === 'gemini'       ? `Я работаю через OpenRouter API, модель: ${geminiModel}.`
        : provider === 'grok'         ? `Я работаю через OpenRouter API, модель: ${grokModel}.`
        : provider === 'qwen-coder'   ? `Я работаю через OpenRouter API, модель: ${qwenCoderModel}. Я специализируюсь на коде.`
        : provider === 'deepseek-r1'  ? `Я работаю через OpenRouter API, модель: ${deepseekR1Model}. Я специализируюсь на анализе и отладке кода.`
        : `Я работаю через DeepSeek API, модель: ${deepseekModel}. Я не Claude и не модель Anthropic.`;

  const tools = [
    'Инструменты Гермеса (встроенные команды):',
    '/web <запрос> — поиск в интернете через Perplexity AI с источниками;',
    `/scrape <url> — скрапинг любой веб-страницы через Firecrawl API (${firecrawlApiKey ? 'подключён' : 'не настроен'});`,
    '/myrepos, /myissues, /myprs — GitHub интеграция (личные репозитории и задачи);',
    '/repo, /issues, /pr — публичные GitHub репозитории.',
    `/vprojects — список проектов Vercel; /vdeploys — деплои; /vopen — URL проекта; /vdeploy <name> — задеплоить лендинг (Vercel ${vercelToken ? 'подключён' : 'не настроен'}).`,
    'Если пользователь спрашивает о Firecrawl, веб-скрапинге, Vercel или подключении к сервисам — отвечай на основе этих данных, не говори что ты не можешь делать запросы.',
  ].join(' ');

  const autoMode = chatAutoMode.get(chatId) || false;
  const autoStatus = autoMode
    ? [
        'АВТО-ВЫБОР МОДЕЛИ ВКЛЮЧЁН (/auto активен).',
        'Текущий запрос автоматически маршрутизируется к лучшей модели по типу задачи:',
        'копирайтинг/реклама → Claude Sonnet;',
        'стратегия/аналитика рынка → Gemini;',
        'посты для соцсетей → Grok;',
        'написание кода → Qwen Coder;',
        'отладка/ревью кода → DeepSeek R1;',
        'длинные документы → MiniMax;',
        'поиск в интернете → Perplexity;',
        'всё остальное → основной провайдер.',
        'Эта маршрутизация реализована ВНУТРИ ГЕРМЕСА на уровне кода бота — не через OpenRouter auto-routing.',
        'Если пользователь спрашивает про автовыбор, отвечай что он ВКЛЮЧЁН командой /auto и работает по описанным правилам.',
      ].join(' ')
    : 'Авто-выбор модели ВЫКЛЮЧЕН (команда /auto). Все запросы идут через фиксированный провайдер: ' + provider + '. Пользователь может включить авто-режим командой /auto.';

  const base = [
    'Ты Гермес, дружелюбный Telegram-помощник.',
    'Гермес - это имя продукта, а не роль: не отыгрывай мифологического персонажа и не используй обращения вроде "смертный".',
    identity,
    autoStatus,
    tools,
    'Если пользователь спрашивает, какая ты модель или кто под капотом, отвечай именно этой информацией.',
    'Никогда не называй себя Claude, Anthropic, ChatGPT или OpenAI-моделью.',
    'Отвечай по-русски, если пользователь не попросил другой язык.',
    'Будь полезным, ясным и не слишком многословным.',
  ].join(' ');

  const profile = getProfile(chatId);

  if (!profile) {
    const docCtxNoProfile = docContexts.get(chatId);
    const docSectionNoProfile = docCtxNoProfile
      ? `\n\n\u{1F4C4} НАЧАЛО ДОКУМЕНТА (файл: ${docCtxNoProfile.fileName.replace(/[\r\n]/g, ' ').slice(0, 200)})\n${docCtxNoProfile.text}\n\u{1F4C4} КОНЕЦ ДОКУМЕНТА\nПользователь может задавать вопросы по этому документу.`
      : '';
    return [base, 'Если пользователь выглядит новым, мягко предложи команду /onboarding.'].join(' ') + docSectionNoProfile;
  }

  const docCtx = docContexts.get(chatId);
  const docSection = docCtx
    ? `\n\n\u{1F4C4} НАЧАЛО ДОКУМЕНТА (файл: ${docCtx.fileName.replace(/[\r\n]/g, ' ').slice(0, 200)})\n${docCtx.text}\n\u{1F4C4} КОНЕЦ ДОКУМЕНТА\nПользователь может задавать вопросы по этому документу.`
    : '';

  return [
    base,
    `Профиль пользователя: имя - ${profile.name || 'не указано'}; основные задачи - ${profile.focus || 'не указано'}; стиль ответов - ${profile.tone || 'не указано'}.`,
  ].join(' ') + docSection;
}

function getUserId(ctx) {
  return ctx.from?.id?.toString();
}

function isAuthorized(ctx) {
  return allowedUserIds.length === 0 || allowedUserIds.includes(getUserId(ctx));
}

function getChatHistory(chatId) {
  if (!histories.has(chatId)) {
    histories.set(chatId, []);
  }

  return histories.get(chatId);
}

function remember(chatId, userMessage, assistantMessage) {
  const history = getChatHistory(chatId);
  const storedAssistantMessage = {
    role: 'assistant',
    content: assistantMessage.content || '',
  };

  history.push({ role: 'user', content: userMessage });
  history.push(storedAssistantMessage);

  if (history.length > maxHistoryMessages) {
    history.splice(0, history.length - maxHistoryMessages);
  }
}

function splitTelegramMessage(text) {
  const chunks = [];
  let rest = text;

  while (rest.length > telegramMessageLimit) {
    let splitAt = rest.lastIndexOf('\n', telegramMessageLimit);

    if (splitAt < telegramMessageLimit * 0.6) {
      splitAt = rest.lastIndexOf(' ', telegramMessageLimit);
    }

    if (splitAt < 1) {
      splitAt = telegramMessageLimit;
    }

    chunks.push(rest.slice(0, splitAt).trim());
    rest = rest.slice(splitAt).trim();
  }

  if (rest) {
    chunks.push(rest);
  }

  return chunks;
}

function getToneLabel(tone) {
  const labels = {
    short: 'коротко и по делу',
    detailed: 'подробно, с контекстом',
    steps: 'по шагам',
  };

  return labels[tone] || tone;
}

async function startOnboarding(ctx) {
  const telegramName = [ctx.from?.first_name, ctx.from?.last_name]
    .filter(Boolean)
    .join(' ');

  onboardingStates.set(ctx.chat.id, {
    step: 'name',
    profile: {
      telegramUserId: ctx.from?.id,
      username: ctx.from?.username || null,
      name: telegramName || '',
    },
  });

  await reply(
    ctx,
    [
      'Давайте настроим Гермеса под вас.',
      '',
      'Шаг 1 из 3: как вас называть?',
      telegramName
        ? `Можно просто написать "${telegramName}" или свой вариант.`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

async function finishOnboarding(ctx, tone) {
  const state = onboardingStates.get(ctx.chat.id);

  if (!state) {
    await startOnboarding(ctx);
    return;
  }

  const profile = {
    ...state.profile,
    tone: getToneLabel(tone),
    completedAt: new Date().toISOString(),
  };

  saveProfile(ctx.chat.id, profile);
  onboardingStates.delete(ctx.chat.id);
  histories.delete(ctx.chat.id);

  await reply(
    ctx,
    [
      'Онбординг готов.',
      '',
      `Имя: ${profile.name || '-'}`,
      `Основные задачи: ${profile.focus || '-'}`,
      `Стиль: ${profile.tone || '-'}`,
      '',
      'Теперь можно писать обычные сообщения, а я буду учитывать эти настройки.',
    ].join('\n'),
  );
}

async function handleOnboardingText(ctx, message) {
  const state = onboardingStates.get(ctx.chat.id);

  if (!state) {
    return false;
  }

  if (message.startsWith('/')) {
    await reply(
      ctx,
      'Сейчас идёт онбординг. Ответьте на текущий вопрос или отправьте /onboarding заново.',
    );
    return true;
  }

  if (state.step === 'name') {
    state.profile.name = message.slice(0, 80);
    state.step = 'focus';

    await reply(
      ctx,
      [
        `Отлично, ${state.profile.name}.`,
        '',
        'Шаг 2 из 3: для чего чаще всего будете использовать Гермеса?',
        'Например: код, учёба, тексты, планы, идеи, работа с файлами.',
      ].join('\n'),
    );
    return true;
  }

  if (state.step === 'focus') {
    state.profile.focus = message.slice(0, 500);
    state.step = 'tone';

    await reply(
      ctx,
      'Шаг 3 из 3: какой стиль ответов предпочитаете?',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Коротко', callback_data: 'onboarding_tone:short' }],
            [{ text: 'Подробно', callback_data: 'onboarding_tone:detailed' }],
            [{ text: 'По шагам', callback_data: 'onboarding_tone:steps' }],
          ],
        },
      },
    );
    return true;
  }

  if (state.step === 'tone') {
    await finishOnboarding(ctx, message.slice(0, 80));
    return true;
  }

  return false;
}

function formatProfile(chatId) {
  const profile = getProfile(chatId);

  if (!profile) {
    return 'Профиль пока не настроен. Запустите /onboarding.';
  }

  return [
    'Профиль Гермеса:',
    '',
    `Имя: ${profile.name || '-'}`,
    `Основные задачи: ${profile.focus || '-'}`,
    `Стиль: ${profile.tone || '-'}`,
  ].join('\n');
}

function formatModelInfo(chatId) {
  const provider = getChatProvider(chatId);
  if (provider === 'perplexity') {
    return [
      'Модель Гермеса:',
      '',
      'Провайдер: Perplexity AI',
      `Model ID: ${perplexityModel}`,
      `Endpoint: ${perplexityBaseUrl}`,
      '',
      'Переключиться: /provider',
    ].join('\n');
  }
  if (provider === 'openrouter') {
    return [
      'Модель Гермеса:',
      '',
      'Провайдер: OpenRouter',
      `Model ID: ${openrouterModel}`,
      `Endpoint: ${openrouterBaseUrl}`,
      '',
      'Переключиться: /provider',
    ].join('\n');
  }
  if (provider === 'minimax') {
    return [
      'Модель Гермеса:',
      '',
      'Провайдер: OpenRouter / MiniMax',
      `Model ID: ${minimaxModel}`,
      `Endpoint: ${openrouterBaseUrl}`,
      '',
      'Переключиться: /provider',
    ].join('\n');
  }
  const orModels = {
    claude:        { label: 'OpenRouter / Anthropic Claude', model: claudeModel },
    gemini:        { label: 'OpenRouter / Google Gemini',    model: geminiModel },
    grok:          { label: 'OpenRouter / xAI Grok',         model: grokModel },
    'qwen-coder':  { label: 'OpenRouter / Qwen Coder',       model: qwenCoderModel },
    'deepseek-r1': { label: 'OpenRouter / DeepSeek R1',      model: deepseekR1Model },
  };
  if (orModels[provider]) {
    return [
      'Модель Гермеса:',
      '',
      `Провайдер: ${orModels[provider].label}`,
      `Model ID: ${orModels[provider].model}`,
      `Endpoint: ${openrouterBaseUrl}`,
      '',
      'Переключиться: /provider',
    ].join('\n');
  }
  return [
    'Модель Гермеса:',
    '',
    'Провайдер: DeepSeek API',
    `Model ID: ${deepseekModel}`,
    `Endpoint: ${deepseekBaseUrl}`,
    '',
    'Переключиться: /provider',
  ].join('\n');
}

function isModelIdentityQuestion(message) {
  const normalized = message.toLowerCase();

  return (
    normalized.includes('какая модель') ||
    normalized.includes('что за модель') ||
    normalized.includes('какую модель') ||
    normalized.includes('кто под капотом') ||
    normalized.includes('на какой модели') ||
    normalized.includes('claude') ||
    normalized.includes('anthropic') ||
    normalized.includes('deepseek') ||
    normalized.includes('perplexity') ||
    normalized.includes('openrouter') ||
    normalized.includes('open router') ||
    normalized.includes('hermes') ||
    normalized.includes('sonnet') ||
    normalized.includes('minimax')
  );
}

async function askDeepSeek(chatId, userMessage) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  const messages = [
    { role: 'system', content: buildSystemPrompt(chatId) },
    ...getChatHistory(chatId),
    { role: 'user', content: userMessage },
  ];

  try {
    let { message: assistantMessage, usage } = await requestDeepSeek(messages, {
      signal: controller.signal,
      thinking: deepseekThinkingEnabled,
    });
    let answer = assistantMessage?.content?.trim();

    if (!answer && deepseekThinkingEnabled) {
      ({ message: assistantMessage, usage } = await requestDeepSeek(messages, {
        signal: controller.signal,
        thinking: false,
      }));
      answer = assistantMessage?.content?.trim();
    }

    if (!answer) {
      throw new Error('DeepSeek returned an empty final answer.');
    }

    remember(chatId, userMessage, { role: 'assistant', content: answer });

    const inputTokens = usage?.prompt_tokens || 0;
    const outputTokens = usage?.completion_tokens || 0;
    const costUsd = calcCost('deepseek', deepseekModel, inputTokens, outputTokens);
    if (costUsd != null) recordSpend('deepseek', deepseekModel, inputTokens, outputTokens, costUsd);

    return answer + buildCostFooter('deepseek', deepseekModel, inputTokens, outputTokens, costUsd);
  } finally {
    clearTimeout(timeout);
  }
}

async function requestDeepSeek(messages, { signal, thinking }) {
  let lastError = null;

  for (let attempt = 1; attempt <= deepseekMaxAttempts; attempt += 1) {
    try {
      return await requestDeepSeekOnce(messages, { signal, thinking });
    } catch (error) {
      lastError = error;

      if (signal?.aborted || attempt >= deepseekMaxAttempts) {
        break;
      }

      console.error(
        `DeepSeek request attempt ${attempt} failed, retrying:`,
        error,
      );
      await delay(1000 * attempt);
    }
  }

  throw lastError;
}

async function requestDeepSeekOnce(messages, { signal, thinking }) {
  const body = {
    model: deepseekModel,
    messages,
    max_tokens: Number(process.env.DEEPSEEK_MAX_TOKENS || 2000),
  };

  if (thinking) {
    body.reasoning_effort = 'high';
    body.thinking = { type: 'enabled' };
  }

  const response = await fetch(`${deepseekBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deepseekApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`DeepSeek API ${response.status}: ${responseText}`);
  }

  const payload = JSON.parse(responseText);
  return { message: payload?.choices?.[0]?.message, usage: payload?.usage };
}

async function callPerplexityAPI(chatId, userMessage) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  const messages = [
    { role: 'system', content: buildSystemPrompt(chatId) },
    ...getChatHistory(chatId),
    { role: 'user', content: userMessage },
  ];

  try {
    const response = await fetch(`${perplexityBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${perplexityApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: perplexityModel,
        messages,
        max_tokens: Number(process.env.DEEPSEEK_MAX_TOKENS || 2000),
      }),
      signal: controller.signal,
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`Perplexity API ${response.status}: ${responseText}`);
    }

    const payload = JSON.parse(responseText);
    const answer = payload?.choices?.[0]?.message?.content?.trim();

    if (!answer) {
      throw new Error('Perplexity returned an empty answer.');
    }

    const inputTokens = payload?.usage?.prompt_tokens || 0;
    const outputTokens = payload?.usage?.completion_tokens || 0;
    const costUsd = calcCost('perplexity', perplexityModel, inputTokens, outputTokens);

    return {
      answer,
      citations: payload?.citations || [],
      inputTokens,
      outputTokens,
      costUsd,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function citationHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
}

async function askPerplexity(chatId, userMessage) {
  const { answer, citations, inputTokens, outputTokens, costUsd } =
    await callPerplexityAPI(chatId, userMessage);

  let finalAnswer = answer;
  if (citations.length > 0) {
    const citationLines = citations
      .slice(0, 5)
      .map((url, i) => `${i + 1}. ${url}`)
      .join('\n');
    finalAnswer = `${answer}\n\nИсточники:\n${citationLines}`;
  }

  remember(chatId, userMessage, { role: 'assistant', content: answer });
  if (costUsd != null) recordSpend('perplexity', perplexityModel, inputTokens, outputTokens, costUsd);

  return finalAnswer + buildCostFooter('perplexity', perplexityModel, inputTokens, outputTokens, costUsd);
}

async function askViaOpenRouter(chatId, userMessage, model, providerKey) {
  const controller = new AbortController();
  // Thinking models (gemini, deepseek-r1, qwen) need more time
  const timeoutMs = ['gemini', 'deepseek-r1', 'qwen-coder'].includes(providerKey) ? 180000 : 120000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const messages = [
    { role: 'system', content: buildSystemPrompt(chatId) },
    ...getChatHistory(chatId),
    { role: 'user', content: userMessage },
  ];

  try {
    const response = await fetch(`${openrouterBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openrouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/hermes-bot',
        'X-Title': 'Hermes Bot',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: providerKey === 'gemini'
          ? Number(process.env.GEMINI_MAX_TOKENS || 8000)
          : Number(process.env.DEEPSEEK_MAX_TOKENS || 2000),
      }),
      signal: controller.signal,
    });

    const responseText = await response.text();
    if (!response.ok) throw new Error(`${providerKey} (OpenRouter) ${response.status}: ${responseText}`);

    const payload = JSON.parse(responseText);
    const msg = payload?.choices?.[0]?.message;
    // Thinking models (Gemini, Qwen) put output in reasoning when content is null
    const answer = (msg?.content || msg?.reasoning || '').trim();
    if (!answer) throw new Error(`${providerKey} вернул пустой ответ.`);

    remember(chatId, userMessage, { role: 'assistant', content: answer });

    const inputTokens = payload?.usage?.prompt_tokens || 0;
    const outputTokens = payload?.usage?.completion_tokens || 0;
    const costUsd = calcCost(providerKey, model, inputTokens, outputTokens);
    if (costUsd != null) recordSpend(providerKey, model, inputTokens, outputTokens, costUsd);

    return answer + buildCostFooter(providerKey, model, inputTokens, outputTokens, costUsd);
  } finally {
    clearTimeout(timeout);
  }
}

const askOpenRouter  = (chatId, msg) => askViaOpenRouter(chatId, msg, openrouterModel, 'openrouter');
const askMiniMax     = (chatId, msg) => askViaOpenRouter(chatId, msg, minimaxModel,    'minimax');
const askClaude      = (chatId, msg) => askViaOpenRouter(chatId, msg, claudeModel,     'claude');
const askGemini      = (chatId, msg) => askViaOpenRouter(chatId, msg, geminiModel,     'gemini');
const askGrok        = (chatId, msg) => askViaOpenRouter(chatId, msg, grokModel,       'grok');
const askQwenCoder   = (chatId, msg) => askViaOpenRouter(chatId, msg, qwenCoderModel,  'qwen-coder');
const askDeepSeekR1  = (chatId, msg) => askViaOpenRouter(chatId, msg, deepseekR1Model, 'deepseek-r1');

function detectProvider(message) {
  const t = message.toLowerCase();

  // 1. Поиск актуальной информации → Perplexity
  // Срабатывает: "найди", "что сейчас стоит", "актуальные цены", "новости", "погугли"
  if (/найди\b|поищи\b|погугли|что сейчас|актуальн|последние новости|в 2025|в 2026|сколько стоит|цены на|что у конкурент/.test(t)) {
    return 'perplexity';
  }

  // 2. Длинное сообщение (>1500 символов) → MiniMax (1M контекст)
  // Срабатывает: вставил целый документ, прайс, меню на утверждение
  if (message.length > 1500) {
    return 'minimax';
  }

  // 3. Код с блоками → Qwen Coder (если есть ```code``` в сообщении)
  if (/```[\s\S]/.test(message)) {
    // Если просят проверить/исправить блок кода — R1
    if (/проверь|найди баг|почему|ошибк|не работает|исправь/.test(t)) return 'deepseek-r1';
    return 'qwen-coder';
  }

  // 4. Написать код → Qwen Coder
  // Срабатывает: "напиши скрипт", "сделай функцию", "создай компонент", "автоматизируй"
  if (/напиши (код|скрипт|функци|класс|модул)|сделай скрипт|создай (функц|скрипт|компонент|интеграц)|автоматизируй|implement/.test(t)) {
    return 'qwen-coder';
  }

  // 5. Отладка/ревью кода → DeepSeek R1
  // Срабатывает: "проверь код", "найди баг", "почему не работает", "review"
  if (/проверь код|найди баг|дебаг|ошибка в коде|почему не работает|review код|отладк|что не так с/.test(t)) {
    return 'deepseek-r1';
  }

  // 6. Длинные документы / таблицы → MiniMax
  // Срабатывает: "вот документ", "таблица", "полный отчёт", "весь файл"
  if (/вот документ|весь файл|полный отчёт|таблиц|прайс-лист|большой текст/.test(t)) {
    return 'minimax';
  }

  // 7. Соцсети / вирусный контент → Grok
  // Срабатывает: посты для инсты/тг, reels, сторис, мемы, вирусный
  if (/инстаграм|instagram|reels|сторис|stories|пост для тг|пост в тг|тикток|tiktok|вирусн|мем\b|smm|контент для соцсет/.test(t)) {
    return 'grok';
  }

  // 8. Маркетинговые тексты / копирайтинг → Claude
  // Срабатывает: реклама, слоган, оффер, акция, описание блюда, email-рассылка
  if (/реклам|объявлени|слоган|оффер|продающ|текст для|описани блюд|текст меню|акци\b|скидк|лендинг|landing|email.рассылк|письмо клиент|баннер/.test(t)) {
    return 'claude';
  }

  // 9. Стратегия / аналитика → Gemini
  // Срабатывает: маркетинг-план, анализ конкурентов, целевая аудитория, KPI
  if (/стратег|маркетинг.план|контент.план|анализ рынка|целевая аудитор|сегментац|позиционирован|конкурент|kpi|метрик|аналитик рынк|исследовани/.test(t)) {
    return 'gemini';
  }

  return defaultProvider;
}

async function askAI(chatId, userMessage) {
  let provider;
  let autoLabel = '';

  if (chatAutoMode.get(chatId)) {
    provider = detectProvider(userMessage);
    autoLabel = `\n[авто: ${provider}]`;
  } else {
    provider = getChatProvider(chatId);
  }

  const dispatch = {
    perplexity:    () => askPerplexity(chatId, userMessage),
    openrouter:    () => askOpenRouter(chatId, userMessage),
    minimax:       () => askMiniMax(chatId, userMessage),
    claude:        () => askClaude(chatId, userMessage),
    gemini:        () => askGemini(chatId, userMessage),
    grok:          () => askGrok(chatId, userMessage),
    'qwen-coder':  () => askQwenCoder(chatId, userMessage),
    'deepseek-r1': () => askDeepSeekR1(chatId, userMessage),
  };

  const fn = dispatch[provider] || (() => askDeepSeek(chatId, userMessage));
  const result = await fn();
  return autoLabel ? result + autoLabel : result;
}

async function replyLong(ctx, text) {
  for (const chunk of splitTelegramMessage(text)) {
    await reply(ctx, chunk);
  }
}

function githubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
  return headers;
}

async function githubFetch(path) {
  const response = await fetch(`${githubBaseUrl}${path}`, {
    headers: githubHeaders(),
  });
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 404) throw new Error('Репозиторий не найден.');
    if (response.status === 403) throw new Error('GitHub API: превышен лимит запросов. Добавь GITHUB_TOKEN в .env.');
    throw new Error(`GitHub API ${response.status}`);
  }
  return JSON.parse(text);
}

function parseRepoArg(text, command) {
  const query = text.replace(new RegExp(`^\\/${command}\\s*`, 'i'), '').trim();
  if (!query) return null;
  const match = query.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  return match ? { owner: match[1], repo: match[2] } : null;
}

function formatRepo(r) {
  return [
    `${r.full_name}`,
    r.description || '',
    '',
    `Звёзды: ${r.stargazers_count}  Форки: ${r.forks_count}  Issues: ${r.open_issues_count}`,
    `Язык: ${r.language || '-'}`,
    `Лицензия: ${r.license?.spdx_id || '-'}`,
    `Ветка: ${r.default_branch}`,
    `Создан: ${r.created_at.slice(0, 10)}`,
    '',
    r.html_url,
  ].filter(l => l !== undefined).join('\n');
}

bot.command('myrepos', async ctx => {
  if (!githubToken) {
    await reply(ctx, 'GITHUB_TOKEN не настроен. Добавьте токен в .env и перезапустите бота.');
    return;
  }
  await sendChatAction(ctx, 'typing');
  try {
    const repos = await githubFetch('/user/repos?sort=updated&per_page=15&affiliation=owner');
    if (repos.length === 0) {
      await reply(ctx, 'Репозиториев не найдено.');
      return;
    }
    const lines = ['Твои репозитории:\n'];
    for (const r of repos) {
      const priv = r.private ? '🔒' : '🌐';
      const lang = r.language ? ` · ${r.language}` : '';
      lines.push(`${priv} ${r.full_name}${lang}`);
    }
    await reply(ctx, lines.join('\n'));
  } catch (e) {
    await reply(ctx, e.message);
  }
});

bot.command('myissues', async ctx => {
  if (!githubToken) {
    await reply(ctx, 'GITHUB_TOKEN не настроен. Добавьте токен в .env и перезапустите бота.');
    return;
  }
  await sendChatAction(ctx, 'typing');
  try {
    const items = await githubFetch('/issues?filter=assigned&state=open&per_page=10');
    if (items.length === 0) {
      await reply(ctx, 'Открытых issues нет.');
      return;
    }
    const lines = ['Твои открытые issues:\n'];
    for (const i of items) lines.push(`#${i.number} ${i.title}\n  ${i.repository_url.replace('https://api.github.com/repos/', '')}`);
    await reply(ctx, lines.join('\n'));
  } catch (e) {
    await reply(ctx, e.message);
  }
});

bot.command('myprs', async ctx => {
  if (!githubToken) {
    await reply(ctx, 'GITHUB_TOKEN не настроен. Добавьте токен в .env и перезапустите бота.');
    return;
  }
  await sendChatAction(ctx, 'typing');
  try {
    const result = await githubFetch('/search/issues?q=is:pr+is:open+author:@me&per_page=10');
    const prs = result.items || [];
    if (prs.length === 0) {
      await reply(ctx, 'Открытых PR нет.');
      return;
    }
    const lines = ['Твои открытые PR:\n'];
    for (const p of prs) lines.push(`#${p.number} ${p.title}\n  ${p.repository_url.replace('https://api.github.com/repos/', '')}`);
    await reply(ctx, lines.join('\n'));
  } catch (e) {
    await reply(ctx, e.message);
  }
});

bot.command('repo', async ctx => {
  const arg = parseRepoArg(ctx.message.text, 'repo');
  if (!arg) {
    await reply(ctx, 'Укажи репозиторий. Например: /repo microsoft/vscode');
    return;
  }
  await sendChatAction(ctx, 'typing');
  try {
    const r = await githubFetch(`/repos/${arg.owner}/${arg.repo}`);
    await reply(ctx, formatRepo(r));
  } catch (e) {
    await reply(ctx, e.message);
  }
});

bot.command('issues', async ctx => {
  const arg = parseRepoArg(ctx.message.text, 'issues');
  if (!arg) {
    await reply(ctx, 'Укажи репозиторий. Например: /issues microsoft/vscode');
    return;
  }
  await sendChatAction(ctx, 'typing');
  try {
    const items = await githubFetch(`/repos/${arg.owner}/${arg.repo}/issues?state=open&per_page=10`);
    const issues = items.filter(i => !i.pull_request);
    if (issues.length === 0) {
      await reply(ctx, `Открытых issues в ${arg.owner}/${arg.repo} нет.`);
      return;
    }
    const lines = [`Открытые issues в ${arg.owner}/${arg.repo}:\n`];
    for (const i of issues) lines.push(`#${i.number} ${i.title}`);
    await reply(ctx, lines.join('\n'));
  } catch (e) {
    await reply(ctx, e.message);
  }
});

bot.command('pr', async ctx => {
  const arg = parseRepoArg(ctx.message.text, 'pr');
  if (!arg) {
    await reply(ctx, 'Укажи репозиторий. Например: /pr microsoft/vscode');
    return;
  }
  await sendChatAction(ctx, 'typing');
  try {
    const prs = await githubFetch(`/repos/${arg.owner}/${arg.repo}/pulls?state=open&per_page=10`);
    if (prs.length === 0) {
      await reply(ctx, `Открытых PR в ${arg.owner}/${arg.repo} нет.`);
      return;
    }
    const lines = [`Открытые PR в ${arg.owner}/${arg.repo}:\n`];
    for (const p of prs) lines.push(`#${p.number} ${p.title} (@${p.user.login})`);
    await reply(ctx, lines.join('\n'));
  } catch (e) {
    await reply(ctx, e.message);
  }
});

async function vercelFetch(path, options = {}) {
  const url = new URL(`${vercelBaseUrl}${path}`);
  if (vercelTeamId) url.searchParams.set('teamId', vercelTeamId);

  const response = await fetch(url.toString(), {
    ...options,
    headers: {
      Authorization: `Bearer ${vercelToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(30000),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`Vercel ${response.status}: ${text}`);
  return JSON.parse(text);
}

bot.command('vprojects', async ctx => {
  if (!vercelToken) {
    await reply(ctx, 'VERCEL_API_TOKEN не настроен. Добавьте токен в .env.');
    return;
  }
  await sendChatAction(ctx, 'typing');
  try {
    const data = await vercelFetch('/v9/projects?limit=20');
    const projects = data.projects || [];
    if (projects.length === 0) {
      await reply(ctx, 'Проектов на Vercel нет. Создайте первый через /vdeploy.');
      return;
    }
    const lines = ['Проекты на Vercel:\n'];
    for (const p of projects) {
      const domain = p.alias?.[0]?.domain || `${p.name}.vercel.app`;
      lines.push(`• ${p.name}\n  https://${domain}`);
    }
    await reply(ctx, lines.join('\n'));
  } catch (e) {
    await reply(ctx, `Ошибка Vercel: ${e.message}`);
  }
});

bot.command('vdeploys', async ctx => {
  if (!vercelToken) {
    await reply(ctx, 'VERCEL_API_TOKEN не настроен.');
    return;
  }
  const projectName = ctx.message.text.replace(/^\/vdeploys\s*/i, '').trim();
  await sendChatAction(ctx, 'typing');
  try {
    const path = projectName
      ? `/v6/deployments?app=${encodeURIComponent(projectName)}&limit=5`
      : '/v6/deployments?limit=5';
    const data = await vercelFetch(path);
    const deploys = data.deployments || [];
    if (deploys.length === 0) {
      await reply(ctx, 'Деплоев не найдено.');
      return;
    }
    const stateEmoji = s => ({ READY: '✅', ERROR: '❌', BUILDING: '🔄', CANCELED: '⏹' }[s] || '❓');
    const lines = ['Последние деплои:\n'];
    for (const d of deploys) {
      const date = new Date(d.createdAt).toLocaleDateString('ru');
      lines.push(`${stateEmoji(d.state)} ${d.name} · ${d.state} · ${date}\n  https://${d.url}`);
    }
    await reply(ctx, lines.join('\n'));
  } catch (e) {
    await reply(ctx, `Ошибка Vercel: ${e.message}`);
  }
});

bot.command('vopen', async ctx => {
  if (!vercelToken) {
    await reply(ctx, 'VERCEL_API_TOKEN не настроен.');
    return;
  }
  const projectName = ctx.message.text.replace(/^\/vopen\s*/i, '').trim();
  await sendChatAction(ctx, 'typing');
  try {
    if (projectName) {
      const data = await vercelFetch(`/v9/projects/${encodeURIComponent(projectName)}`);
      const domain = data.alias?.[0]?.domain || `${data.name}.vercel.app`;
      await reply(ctx, `${data.name}\nhttps://${domain}`);
    } else {
      const data = await vercelFetch('/v9/projects?limit=5');
      const projects = data.projects || [];
      if (projects.length === 0) {
        await reply(ctx, 'Проектов нет.');
        return;
      }
      const lines = projects.map(p => {
        const domain = p.alias?.[0]?.domain || `${p.name}.vercel.app`;
        return `• ${p.name}: https://${domain}`;
      });
      await reply(ctx, lines.join('\n'));
    }
  } catch (e) {
    await reply(ctx, `Ошибка Vercel: ${e.message}`);
  }
});

bot.command('vdeploy', async ctx => {
  if (!vercelToken) {
    await reply(ctx, 'VERCEL_API_TOKEN не настроен.');
    return;
  }
  const args = ctx.message.text.replace(/^\/vdeploy\s*/i, '').trim();
  if (!args) {
    await reply(ctx, 'Укажи имя проекта.\nПример: /vdeploy hermes-landing');
    return;
  }
  await sendChatAction(ctx, 'typing');
  await reply(ctx, `⏳ Деплою ${args} на Vercel...`);
  try {
    const data = await vercelFetch('/v13/deployments', {
      method: 'POST',
      body: JSON.stringify({
        name: args,
        files: [
          {
            file: 'index.html',
            data: `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Гермес — AI-ассистент в Telegram</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0d0d0d;color:#f0f0f0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem}
.card{max-width:600px;text-align:center}
.logo{font-size:4rem;margin-bottom:1rem}
h1{font-size:2.5rem;font-weight:700;background:linear-gradient(135deg,#a78bfa,#60a5fa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:0.5rem}
.sub{color:#888;font-size:1.1rem;margin-bottom:2rem}
.features{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:2rem;text-align:left}
.feat{background:#1a1a2e;border:1px solid #2a2a4a;border-radius:12px;padding:1rem}
.feat-icon{font-size:1.5rem;margin-bottom:0.4rem}
.feat h3{font-size:0.9rem;color:#a78bfa;margin-bottom:0.2rem}
.feat p{font-size:0.8rem;color:#888}
.btn{display:inline-block;background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;text-decoration:none;padding:0.9rem 2.5rem;border-radius:50px;font-size:1rem;font-weight:600;transition:opacity 0.2s}
.btn:hover{opacity:0.85}
.powered{margin-top:1.5rem;font-size:0.75rem;color:#555}
</style>
</head>
<body>
<div class="card">
  <div class="logo">🪽</div>
  <h1>Гермес</h1>
  <p class="sub">Умный AI-ассистент прямо в Telegram</p>
  <div class="features">
    <div class="feat"><div class="feat-icon">🧠</div><h3>8 AI-моделей</h3><p>DeepSeek, Claude, Gemini, Grok, Perplexity и другие</p></div>
    <div class="feat"><div class="feat-icon">🔍</div><h3>Поиск в сети</h3><p>Актуальные данные через Perplexity с источниками</p></div>
    <div class="feat"><div class="feat-icon">🎨</div><h3>Генерация медиа</h3><p>Картинки FLUX, видео MiniMax, анимация Luma</p></div>
    <div class="feat"><div class="feat-icon">⚡</div><h3>Авто-режим</h3><p>Автоматический выбор лучшей модели под задачу</p></div>
  </div>
  <a class="btn" href="https://t.me/andrei4eg_bot">Открыть в Telegram</a>
  <p class="powered">Powered by OpenRouter · Replicate · Firecrawl · Vercel</p>
</div>
</body>
</html>`,
          },
        ],
        projectSettings: { framework: null },
        target: 'production',
      }),
    });

    const deployUrl = `https://${data.url}`;
    await reply(ctx, `✅ Деплой запущен!\n\n${data.name}\n${deployUrl}\n\nСтатус: ${data.readyState || 'BUILDING'}`);
  } catch (e) {
    await reply(ctx, `Не удалось задеплоить: ${e.message}`);
  }
});

bot.command('whoami', async ctx => {
  const user = ctx.from;
  await reply(
    ctx,
    [
      `Ваш Telegram ID: ${user.id}`,
      `Username: ${user.username ? `@${user.username}` : '-'}`,
      `Имя: ${
        [user.first_name, user.last_name].filter(Boolean).join(' ') || '-'
      }`,
    ].join('\n'),
  );
});

bot.use(async (ctx, next) => {
  if (isAuthorized(ctx)) {
    return next();
  }

  await reply(ctx, 'Доступ к Гермесу закрыт. Отправьте /whoami владельцу бота.');
});

bot.start(async ctx => {
  if (!getProfile(ctx.chat.id)) {
    await startOnboarding(ctx);
    return;
  }

  const provider = getChatProvider(ctx.chat.id);
  const providerLabels = {
    deepseek:      `DeepSeek (${deepseekModel})`,
    openrouter:    `OpenRouter / DeepSeek (${openrouterModel})`,
    minimax:       `MiniMax M3 (${minimaxModel})`,
    claude:        `Claude Sonnet (${claudeModel})`,
    gemini:        `Google Gemini (${geminiModel})`,
    grok:          `xAI Grok (${grokModel})`,
    'qwen-coder':  `Qwen Coder (${qwenCoderModel})`,
    'deepseek-r1': `DeepSeek R1 (${deepseekR1Model})`,
    perplexity:    `Perplexity AI (${perplexityModel})`,
  };
  await reply(
    ctx,
    [
      'Гермес на связи.',
      '',
      `Сейчас я отвечаю через ${providerLabels[provider] || provider}.`,
      'Профиль уже настроен. Команды: /help, /ping, /reset, /provider, /profile, /model, /onboarding, /whoami.',
    ].join('\n'),
  );
});

bot.help(async ctx => {
  const provider = getChatProvider(ctx.chat.id);
  const modelLabels = {
    deepseek: deepseekModel,
    openrouter: openrouterModel,
    perplexity: perplexityModel,
  };
  await reply(
    ctx,
    [
      `Гермес сейчас работает как Telegram-бот на ${modelLabels[provider] || provider}.`,
      '',
      '/start - начать',
      '/ping - проверить, что бот живой',
      '/reset - очистить память этого чата',
      'голосовые сообщения — отправь голосовое, Гермес транскрибирует и ответит',
      '/image <описание> - сгенерировать изображение (FLUX 1.1 Pro Ultra)',
      '/video <описание> - сгенерировать видео (MiniMax Video-01)',
      '/animate [описание] - оживить фото (ответь на фото этой командой)',
      '/web <запрос> - поиск в интернете через Perplexity (с источниками)',
      '/scrape <url> - скрапить страницу и получить её содержимое',
      '/myrepos - твои репозитории на GitHub',
      '/myissues - твои открытые issues',
      '/myprs - твои открытые pull requests',
      '/repo owner/repo - информация о любом репозитории GitHub',
      '/issues owner/repo - открытые issues репозитория',
      '/pr owner/repo - открытые pull requests',
      '/vprojects - список проектов на Vercel',
      '/vdeploys [project] - последние деплои',
      '/vopen [project] - URL проекта',
      '/vdeploy <name> - задеплоить лендинг Гермеса',
      '/stats - расходы на AI (токены, деньги, модели)',
      '/provider - переключить модель (DeepSeek / OpenRouter / MiniMax / Claude / Gemini / Grok / QwenCoder / R1 / Perplexity)',
      '/auto - включить/выключить авто-выбор модели по типу запроса',
      '/model - показать текущую модель',
      '/onboarding - пройти настройку заново',
      '/setup - то же самое, что /onboarding',
      '/profile - показать текущие настройки',
      '/whoami - показать ваш Telegram ID',
      '/help - показать помощь',
    ].join('\n'),
  );
});

bot.command('ping', async ctx => {
  await reply(ctx, 'pong');
});

bot.command('reset', async ctx => {
  histories.delete(ctx.chat.id);
  await reply(ctx, 'Память этого чата очищена.');
});

bot.command('auto', async ctx => {
  const current = chatAutoMode.get(ctx.chat.id) || false;
  const next = !current;
  chatAutoMode.set(ctx.chat.id, next);
  if (next) {
    await reply(ctx, [
      'Авто-выбор модели включён.',
      '',
      'Маркетинг:',
      '  Копирайтинг / реклама / тексты → Claude Sonnet',
      '  Стратегия / анализ рынка / конкуренты → Gemini 2.5 Pro',
      '  Посты для соцсетей / вирусный контент → Grok 3',
      '',
      'Код:',
      '  Написать код / функцию / скрипт → Qwen Coder',
      '  Проверить код / найти баг / debug → DeepSeek R1',
      '',
      'Другое:',
      '  Длинные документы / таблицы → MiniMax M3',
      '  Поиск в интернете → Perplexity',
      '  Всё остальное → основной провайдер',
      '',
      'Отключить: /auto',
    ].join('\n'));
  } else {
    await reply(ctx, `Авто-выбор выключен. Активен провайдер: ${getChatProvider(ctx.chat.id)}`);
  }
});

bot.command(['onboarding', 'setup'], async ctx => {
  histories.delete(ctx.chat.id);
  await startOnboarding(ctx);
});

bot.command('profile', async ctx => {
  await reply(ctx, formatProfile(ctx.chat.id));
});

bot.command('model', async ctx => {
  await reply(ctx, formatModelInfo(ctx.chat.id));
});

bot.command('provider', async ctx => {
  const current = getChatProvider(ctx.chat.id);
  const available = ['deepseek'];
  if (openrouterApiKey) available.push('openrouter', 'minimax', 'claude', 'gemini', 'grok', 'qwen-coder', 'deepseek-r1');
  if (perplexityApiKey) available.push('perplexity');

  const idx = available.indexOf(current);
  const next = available[(idx + 1) % available.length];

  setChatProvider(ctx.chat.id, next);
  histories.delete(ctx.chat.id);

  const labels = {
    deepseek:      `DeepSeek (${deepseekModel})`,
    openrouter:    `OpenRouter / DeepSeek (${openrouterModel})`,
    minimax:       `MiniMax M3 (${minimaxModel})`,
    claude:        `Claude Sonnet (${claudeModel})`,
    gemini:        `Google Gemini (${geminiModel})`,
    grok:          `xAI Grok (${grokModel})`,
    'qwen-coder':  `Qwen Coder (${qwenCoderModel})`,
    'deepseek-r1': `DeepSeek R1 / reasoning (${deepseekR1Model})`,
    perplexity:    `Perplexity AI (${perplexityModel})`,
  };
  await reply(ctx, `Переключено на ${labels[next]}. История чата очищена.`);
});

async function replicatePredict(model, input) {
  const createRes = await fetch(`${replicateBaseUrl}/models/${model}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${replicateApiKey}`,
      'Content-Type': 'application/json',
      Prefer: 'wait=60',
    },
    body: JSON.stringify({ input }),
    signal: AbortSignal.timeout(70000),
  });

  const prediction = await createRes.json();
  if (!createRes.ok) throw new Error(`Replicate ${createRes.status}: ${prediction?.detail || JSON.stringify(prediction)}`);
  if (prediction.status === 'succeeded') return prediction.output;
  if (prediction.status === 'failed') throw new Error(`Replicate failed: ${prediction.error}`);

  const id = prediction.id;
  for (let i = 0; i < 72; i++) {
    await delay(5000);
    const pollRes = await fetch(`${replicateBaseUrl}/predictions/${id}`, {
      headers: { Authorization: `Bearer ${replicateApiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    const poll = await pollRes.json();
    if (poll.status === 'succeeded') return poll.output;
    if (poll.status === 'failed' || poll.status === 'canceled') throw new Error(`Replicate: ${poll.error || poll.status}`);
  }
  throw new Error('Replicate: таймаут генерации (6 минут)');
}

async function enhanceImagePrompt(userPrompt) {
  const res = await fetch(`${openrouterBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openrouterApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/hermes-bot',
      'X-Title': 'Hermes Bot',
    },
    body: JSON.stringify({
      model: openrouterModel,
      messages: [{
        role: 'user',
        content: `You are an expert at writing image generation prompts for FLUX AI model.
Translate and enhance this prompt into English for FLUX. Make it detailed and descriptive.
Add: lighting details, camera angle, style, mood, quality keywords.
Return ONLY the enhanced English prompt, nothing else, no explanations.

User prompt: "${userPrompt}"`,
      }],
      max_tokens: 300,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json();
  return json?.choices?.[0]?.message?.content?.trim() || userPrompt;
}

bot.command('image', async ctx => {
  const userPrompt = ctx.message.text.replace(/^\/image\s*/i, '').trim();
  if (!userPrompt) {
    await reply(ctx, 'Укажи описание после команды.\nПример: /image сочный стейк рибай на гриле');
    return;
  }
  if (!replicateApiKey) {
    await reply(ctx, 'REPLICATE_API_KEY не настроен.');
    return;
  }
  await sendChatAction(ctx, 'upload_photo');
  await reply(ctx, '⏳ Улучшаю промпт и генерирую изображение...');
  try {
    const enhancedPrompt = await enhanceImagePrompt(userPrompt);
    console.log(`Image prompt: "${userPrompt}" → "${enhancedPrompt}"`);

    const output = await replicatePredict(imageModel, {
      prompt: enhancedPrompt,
      aspect_ratio: '1:1',
      output_format: 'jpg',
      safety_tolerance: 2,
    });
    const url = Array.isArray(output) ? output[0] : output;
    await ctx.replyWithPhoto(url, { caption: `FLUX 1.1 Pro Ultra\n📝 ${userPrompt}` });
  } catch (e) {
    console.error('Replicate /image failed:', e);
    await reply(ctx, `Не удалось сгенерировать изображение: ${e.message}`);
  }
});

bot.command('video', async ctx => {
  const prompt = ctx.message.text.replace(/^\/video\s*/i, '').trim();
  if (!prompt) {
    await reply(ctx, 'Укажи описание после команды.\nПример: /video рассвет над морем, кинематографично');
    return;
  }
  if (!replicateApiKey) {
    await reply(ctx, 'REPLICATE_API_KEY не настроен.');
    return;
  }
  await reply(ctx, '⏳ Генерирую видео через MiniMax Video-01... это займёт 2-4 минуты.');
  try {
    const output = await replicatePredict(videoModel, {
      prompt,
      prompt_optimizer: true,
    });
    const url = Array.isArray(output) ? output[0] : output;
    try {
      await ctx.replyWithVideo(url, { caption: `MiniMax Video-01\n${prompt.slice(0, 200)}` });
    } catch {
      await reply(ctx, `Видео готово:\n${url}`);
    }
  } catch (e) {
    console.error('Replicate /video failed:', e);
    await reply(ctx, `Не удалось сгенерировать видео: ${e.message}`);
  }
});

async function getTelegramPhotoUrl(ctx, photoArray) {
  const photo = photoArray[photoArray.length - 1];
  const file = await ctx.telegram.getFile(photo.file_id);
  return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
}

// Download Telegram photo using https.get (reliable for binary)
function downloadUrl(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const get = (u) => {
      const mod = u.startsWith('https') ? https : require('http');
      mod.get(u, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) return reject(new Error(`Download failed: ${res.statusCode}`));
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    };
    get(url);
  });
}

// Download Telegram photo and return as base64 data URL (no external hosting needed)
async function uploadTelegramPhotoToReplicate(ctx, photoArray) {
  const tgUrl = await getTelegramPhotoUrl(ctx, photoArray);
  const imageBuffer = await downloadUrl(tgUrl);
  return `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
}

async function uploadTelegramVoiceToReplicate(ctx, fileId) {
  const file = await ctx.telegram.getFile(fileId);
  const tgUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const audioBuffer = await downloadUrl(tgUrl);
  return `data:audio/ogg;base64,${audioBuffer.toString('base64')}`;
}

function extractTranscription(output) {
  return (
    typeof output === 'string' ? output :
    Array.isArray(output) ? (output[0] ?? '') :
    output?.text || ''
  ).trim();
}

async function animateImage(imageUrl, prompt) {
  const DEFAULT_PROMPT = 'cinematic animation, smooth natural motion, high quality';
  const safePrompt = (prompt && prompt.trim().length >= 3) ? prompt.trim() : DEFAULT_PROMPT;
  return replicatePredict(animateModel, {
    start_image: imageUrl,
    prompt: safePrompt,
    duration: 5,
    aspect_ratio: '16:9',
  });
}

// /animate — работает тремя способами:
// 1. Реплай на фото + /animate
// 2. Просто /animate — берёт последнее присланное фото
// 3. Фото с подписью "оживи" (обрабатывается в photo-хэндлере)
bot.command('animate', async ctx => {
  if (!replicateApiKey) {
    await reply(ctx, 'REPLICATE_API_KEY не настроен.');
    return;
  }

  const promptText = ctx.message.text.replace(/^\/animate\s*/i, '').trim();

  // Source 1: reply to a photo
  const photoArray = ctx.message.reply_to_message?.photo
    // Source 2: last photo sent in this chat
    ?? lastPhotos.get(ctx.chat.id);

  if (!photoArray) {
    await reply(ctx, 'Сначала отправь фото, затем напиши /animate');
    return;
  }

  await reply(ctx, '⏳ Оживляю картинку через Luma Ray 3.2... займёт 2-3 минуты.');
  try {
    const imageUrl = await uploadTelegramPhotoToReplicate(ctx, photoArray);
    const output = await animateImage(imageUrl, promptText || undefined);
    const url = Array.isArray(output) ? output[0] : output;
    try {
      await ctx.replyWithVideo(url, { caption: `Luma Ray 3.2\n${promptText || 'авто-анимация'}` });
    } catch {
      await reply(ctx, `Видео готово:\n${url}`);
    }
  } catch (e) {
    console.error('Animate failed:', e);
    await reply(ctx, `Не удалось оживить картинку: ${e.message}`);
  }
});

// Входящее фото — сохраняем и предлагаем анимировать
bot.on('photo', async ctx => {
  if (!isAuthorized(ctx)) return;

  // Always remember the last photo for this chat
  lastPhotos.set(ctx.chat.id, ctx.message.photo);

  const caption = ctx.message.caption?.toLowerCase() || '';
  const shouldAnimate = /оживи|анимируй|animate|сделай видео из|в видео/.test(caption);

  if (shouldAnimate && replicateApiKey) {
    const promptText = ctx.message.caption
      ?.replace(/оживи|анимируй|animate|сделай видео из|в видео/gi, '')
      .trim();
    await reply(ctx, '⏳ Оживляю картинку через Luma Ray 3.2...');
    try {
      const imageUrl = await uploadTelegramPhotoToReplicate(ctx, ctx.message.photo);
      const output = await animateImage(imageUrl, promptText || undefined);
      const url = Array.isArray(output) ? output[0] : output;
      try {
        await ctx.replyWithVideo(url, { caption: `Luma Ray 3.2` });
      } catch {
        await reply(ctx, `Видео готово:\n${url}`);
      }
    } catch (e) {
      console.error('Animate from photo failed:', e);
      await reply(ctx, `Не удалось оживить картинку: ${e.message}`);
    }
    return;
  }

  // Hint
  if (replicateApiKey) {
    await reply(ctx, 'Фото получено. Напиши /animate чтобы оживить его.');
  }
});

bot.on('voice', async ctx => {
  if (!isAuthorized(ctx)) return;

  if (onboardingStates.has(ctx.chat.id)) {
    await reply(ctx, 'Сейчас идёт онбординг. Ответьте на вопрос текстом.');
    return;
  }

  if (!replicateApiKey) {
    await reply(ctx, 'Голосовые сообщения не поддерживаются (REPLICATE_API_KEY не настроен).');
    return;
  }

  if (!getProfile(ctx.chat.id)) {
    await startOnboarding(ctx);
    return;
  }

  if (ctx.message.voice.duration > 300) {
    await reply(ctx, 'Голосовое сообщение слишком длинное (максимум 5 минут).');
    return;
  }

  await sendChatAction(ctx, 'typing');
  await reply(ctx, '⏳ Транскрибирую...');

  try {
    const audioUrl = await uploadTelegramVoiceToReplicate(ctx, ctx.message.voice.file_id);
    const output = await replicatePredict(voiceModel, { audio: audioUrl });
    const transcription = extractTranscription(output);

    if (!transcription) {
      await reply(ctx, 'Не удалось распознать речь. Попробуй ещё раз или напиши текстом.');
      return;
    }

    console.log(`Voice transcribed (${ctx.message.voice.duration}s): "${transcription.slice(0, 80)}"`);
    await reply(ctx, `🎤 Слышу: «${transcription}»`);
    await sendChatAction(ctx, 'typing');

    const answer = await askAI(ctx.chat.id, transcription);
    await replyLong(ctx, answer);
  } catch (error) {
    console.error('Voice transcription failed:', error);
    await reply(ctx, 'Не удалось транскрибировать голосовое сообщение. Попробуй ещё раз.');
  }
});

const SUPPORTED_DOC_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const DOC_WORD_LIMIT = 15000;
const DOC_SIZE_LIMIT = 20 * 1024 * 1024; // 20 MB

bot.on('document', async ctx => {
  if (!isAuthorized(ctx)) return;

  if (onboardingStates.has(ctx.chat.id)) {
    await reply(ctx, 'Сейчас идёт онбординг. Ответьте на вопрос текстом.');
    return;
  }

  if (!getProfile(ctx.chat.id)) {
    await startOnboarding(ctx);
    return;
  }

  const doc = ctx.message.document;
  const mimeType = doc.mime_type || '';

  if (!SUPPORTED_DOC_MIMES.has(mimeType)) {
    await reply(ctx, 'Формат не поддерживается. Пришли PDF, Word (.docx) или Excel (.xlsx).');
    return;
  }

  if (doc.file_size > DOC_SIZE_LIMIT) {
    await reply(ctx, 'Файл слишком большой (максимум 20 МБ).');
    return;
  }

  docContexts.delete(ctx.chat.id); // clear previous doc when new one arrives

  await sendChatAction(ctx, 'typing');
  await reply(ctx, '📄 Читаю документ...');

  try {
    const file = await ctx.telegram.getFile(doc.file_id);
    const tgUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const buffer = await downloadUrl(tgUrl);

    const rawText = await parseDocument(buffer, mimeType);

    if (!rawText || !rawText.trim()) {
      await reply(ctx, 'Документ не содержит текста (возможно, это скан или защищённый файл).');
      return;
    }

    const wordCount = countWords(rawText);
    const isLarge = wordCount > DOC_WORD_LIMIT;
    const text = isLarge ? truncateToWords(rawText, DOC_WORD_LIMIT) : rawText;
    const fileName = doc.file_name || 'документ';

    if (isLarge) {
      await reply(ctx, `⚠️ Документ большой (~${wordCount} слов), анализирую первые ${DOC_WORD_LIMIT}.`);
    }

    console.log(`Document parsed: "${fileName}" (${wordCount} words, large=${isLarge})`);

    // docContexts intentionally NOT set yet — text goes in user prompt only for this call
    const prompt = `Кратко изложи содержание следующего документа:\n\n${text}`;
    await sendChatAction(ctx, 'typing');
    const summary = await askAI(ctx.chat.id, prompt);
    await replyLong(ctx, `📝 Краткое содержание:\n\n${summary}`);

    if (!isLarge) {
      docContexts.set(ctx.chat.id, { text, fileName }); // enable Q&A after summary
      await reply(ctx, '💬 Можешь задавать вопросы по документу.');
    }
  } catch (error) {
    console.error('Document processing failed:', error);
    await reply(ctx, 'Не удалось прочитать документ. Возможно, файл повреждён или защищён паролем.');
  }
});

async function firecrawlScrape(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${firecrawlBaseUrl}/v1/scrape`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, formats: ['markdown'] }),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) throw new Error(`Firecrawl API ${response.status}: ${text}`);

    const payload = JSON.parse(text);
    const markdown = payload?.data?.markdown?.trim();
    const title = payload?.data?.metadata?.title || '';

    if (!markdown) throw new Error('Firecrawl вернул пустой контент.');

    return { markdown, title };
  } finally {
    clearTimeout(timeout);
  }
}

bot.command('scrape', async ctx => {
  const url = ctx.message.text.replace(/^\/scrape\s*/i, '').trim();

  if (!url) {
    await reply(ctx, 'Укажи URL после команды.\nНапример: /scrape https://example.com');
    return;
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    await reply(ctx, 'Укажи полный URL с https://\nНапример: /scrape https://example.com');
    return;
  }

  if (!firecrawlApiKey) {
    await reply(ctx, 'FIRECRAWL_API_KEY не настроен. Добавьте ключ в .env и перезапустите бота.');
    return;
  }

  await sendChatAction(ctx, 'typing');

  try {
    const { markdown, title } = await firecrawlScrape(url);
    const header = title ? `${title}\n${url}\n${'─'.repeat(30)}\n\n` : `${url}\n${'─'.repeat(30)}\n\n`;
    await replyLong(ctx, header + markdown);
  } catch (error) {
    console.error('Firecrawl /scrape failed:', error);
    await reply(ctx, `Не удалось получить страницу: ${error.message}`);
  }
});

bot.command('web', async ctx => {
  const query = ctx.message.text.replace(/^\/web\s*/i, '').trim();

  if (!query) {
    await reply(ctx, 'Укажи запрос после команды.\nНапример: /web последние новости по DeepSeek');
    return;
  }

  if (!perplexityApiKey) {
    await reply(ctx, 'PERPLEXITY_API_KEY не настроен. Добавьте ключ в .env и перезапустите бота.');
    return;
  }

  if (!getProfile(ctx.chat.id)) {
    await startOnboarding(ctx);
    return;
  }

  await sendChatAction(ctx, 'typing');

  try {
    const { answer, citations, inputTokens, outputTokens, costUsd } =
      await callPerplexityAPI(ctx.chat.id, query);

    remember(ctx.chat.id, query, { role: 'assistant', content: answer });
    if (costUsd != null) recordSpend('perplexity', perplexityModel, inputTokens, outputTokens, costUsd);

    const footer = buildCostFooter('perplexity', perplexityModel, inputTokens, outputTokens, costUsd);
    await replyLong(ctx, answer + footer);

    if (citations.length > 0) {
      const buttons = citations.slice(0, 5).map((url, i) => [
        { text: `${i + 1}. ${citationHostname(url)}`, url },
      ]);
      await reply(ctx, 'Источники:', { reply_markup: { inline_keyboard: buttons } });
    }
  } catch (error) {
    console.error('Perplexity /web request failed:', error);
    await reply(ctx, 'Не смог получить ответ от Perplexity. Проверь ключ, баланс или лимиты API.');
  }
});

bot.command('stats', async ctx => {
  const lines = [
    'Расходы на Гермеса:',
    '',
    `Всего запросов: ${spending.requests || 0}`,
    `Общие расходы: $${(spending.total_usd || 0).toFixed(4)}`,
    '',
    'По моделям:',
  ];

  const models = Object.entries(spending.by_model || {});

  if (models.length === 0) {
    lines.push('  Пока нет данных.');
  } else {
    for (const [key, s] of models) {
      lines.push(`  ${key}: ${s.requests} зап. / $${s.total_usd.toFixed(4)} (${s.input_tokens}→${s.output_tokens} tok)`);
    }
  }

  await reply(ctx, lines.join('\n'));
});

bot.command('health', async ctx => {
  await reply(
    ctx,
    [
      'Гермес жив.',
      '',
      `Telegram: polling`,
      `DeepSeek: подключен · модель ${deepseekModel}`,
      `Режим рассуждений: ${deepseekThinkingEnabled ? 'включен' : 'выключен'}`,
      `OpenRouter: ${openrouterApiKey ? `подключен · ${openrouterModel}` : 'не настроен'}`,
      `MiniMax M3: ${openrouterApiKey ? `подключен · ${minimaxModel} (через OpenRouter)` : 'не настроен'}`,
      `Claude Sonnet: ${openrouterApiKey ? `подключен · ${claudeModel}` : 'не настроен'}`,
      `Gemini 2.5 Pro: ${openrouterApiKey ? `подключен · ${geminiModel}` : 'не настроен'}`,
      `Grok 3: ${openrouterApiKey ? `подключен · ${grokModel}` : 'не настроен'}`,
      `Qwen Coder: ${openrouterApiKey ? `подключен · ${qwenCoderModel}` : 'не настроен'}`,
      `DeepSeek R1: ${openrouterApiKey ? `подключен · ${deepseekR1Model}` : 'не настроен'}`,
      `Perplexity: ${perplexityApiKey ? `подключен · ${perplexityModel}` : 'не настроен'}`,
      `Replicate: ${replicateApiKey ? `подключен · /image · /video · /animate (${animateModel}) · голос (${voiceModel})` : 'не настроен'}`,
      `Firecrawl: ${firecrawlApiKey ? 'подключен · /scrape доступен' : 'не настроен'}`,
      `GitHub: ${githubToken ? 'подключен · /myrepos /myissues /myprs' : 'без токена (только публичные repo)'}`,
      `Vercel: ${vercelToken ? 'подключен · /vprojects /vdeploys /vopen /vdeploy' : 'не настроен'}`,
      `Профиль: ${getProfile(ctx.chat.id) ? 'настроен' : 'не настроен'}`,
    ].join('\n'),
  );
});

bot.action(/^onboarding_tone:(short|detailed|steps)$/, async ctx => {
  await answerCallback(ctx);
  await finishOnboarding(ctx, ctx.match[1]);
});

function isImageRequest(message) {
  const t = message.toLowerCase();
  return /^(нарисуй|нарисовать|сгенерируй|сгенерировать|создай картинку|создай изображение|сделай картинку|сделай изображение|покажи картинку|покажи фото|генерируй картинку|генерируй изображение|draw|generate image|create image|make image)\b/.test(t);
}

function isVideoRequest(message) {
  const t = message.toLowerCase();
  return /^(сгенерируй видео|создай видео|сделай видео|генерируй видео|generate video|create video|make video)\b/.test(t);
}

function extractMediaSubject(message) {
  return message
    .replace(/^(нарисуй|нарисовать|сгенерируй|сгенерировать|создай картинку|создай изображение|сделай картинку|сделай изображение|покажи картинку|покажи фото|генерируй картинку|генерируй изображение|сгенерируй видео|создай видео|сделай видео|генерируй видео|draw|generate image|create image|make image|generate video|create video|make video)\s*/i, '')
    .trim() || message;
}

bot.on('text', async ctx => {
  const message = ctx.message.text.trim();

  if (!message) {
    await reply(ctx, 'Я получил пустое сообщение.');
    return;
  }

  if (await handleOnboardingText(ctx, message)) {
    return;
  }

  if (!getProfile(ctx.chat.id)) {
    await startOnboarding(ctx);
    return;
  }

  if (isModelIdentityQuestion(message)) {
    await reply(ctx, formatModelInfo(ctx.chat.id));
    return;
  }

  // Перехват запросов на генерацию изображений
  if (replicateApiKey && isImageRequest(message)) {
    const subject = extractMediaSubject(message);
    await sendChatAction(ctx, 'upload_photo');
    await reply(ctx, '⏳ Улучшаю промпт и генерирую изображение...');
    try {
      const enhancedPrompt = await enhanceImagePrompt(subject);
      console.log(`Image: "${subject}" → "${enhancedPrompt}"`);
      const output = await replicatePredict(imageModel, {
        prompt: enhancedPrompt,
        aspect_ratio: '1:1',
        output_format: 'jpg',
        safety_tolerance: 2,
      });
      const url = Array.isArray(output) ? output[0] : output;
      await ctx.replyWithPhoto(url, { caption: `FLUX 1.1 Pro Ultra\n📝 ${subject}` });
    } catch (e) {
      console.error('Image generation failed:', e);
      await reply(ctx, `Не удалось сгенерировать изображение: ${e.message}`);
    }
    return;
  }

  // Перехват запросов на генерацию видео
  if (replicateApiKey && isVideoRequest(message)) {
    const subject = extractMediaSubject(message);
    await reply(ctx, '⏳ Генерирую видео... это займёт 2-4 минуты.');
    try {
      const output = await replicatePredict(videoModel, { prompt: subject, prompt_optimizer: true });
      const url = Array.isArray(output) ? output[0] : output;
      try {
        await ctx.replyWithVideo(url, { caption: `MiniMax Video-01\n📝 ${subject}` });
      } catch {
        await reply(ctx, `Видео готово:\n${url}`);
      }
    } catch (e) {
      console.error('Video generation failed:', e);
      await reply(ctx, `Не удалось сгенерировать видео: ${e.message}`);
    }
    return;
  }

  await sendChatAction(ctx, 'typing');

  try {
    const answer = await askAI(ctx.chat.id, message);
    await replyLong(ctx, answer);
  } catch (error) {
    console.error('AI request failed:', error);
    await reply(
      ctx,
      'Не смог получить ответ от AI-провайдера. Проверь ключ, баланс или лимиты API.',
    );
  }
});

bot.catch((error, ctx) => {
  const updateId = ctx?.update?.update_id ?? 'unknown';
  console.error(`Telegram bot error on update ${updateId}:`, error);
});

async function start() {
  const authMode =
    allowedUserIds.length === 0 ? 'open access' : 'restricted access';

  ensureTelegramOutboxWorker();
  console.log(
    `Hermes Telegram bot is starting in polling mode with ${deepseekModel} (${authMode}). Press Ctrl+C to stop.`,
  );

  while (!shuttingDown) {
    try {
      const webhookInfo = await bot.telegram.getWebhookInfo();

      if (webhookInfo.url) {
        await bot.telegram.deleteWebhook({ drop_pending_updates: false });
      }

      bot.botInfo = await bot.telegram.getMe();
      console.log(
        `Hermes Telegram bot is polling as @${bot.botInfo.username} with ${deepseekModel}.`,
      );
      await bot.startPolling();
      if (!shuttingDown) {
        console.error('Polling stopped unexpectedly, restarting in 5s.');
        await delay(5000);
      }
    } catch (error) {
      if (shuttingDown) {
        return;
      }

      console.error('Polling failed, retrying in 15s:', error);
      try {
        bot.stop('polling retry');
      } catch {}
      await delay(15000);
    }
  }
}

start().catch(error => {
  console.error('Failed to start Hermes Telegram bot:', error);
  process.exit(1);
});

function stop(reason) {
  shuttingDown = true;
  try {
    bot.stop(reason);
  } catch {}
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});
process.on('unhandledRejection', error => {
  console.error('Unhandled rejection:', error);
});
process.on('exit', code => {
  try {
    fs.appendFileSync(
      path.join(logsDir, 'hermes-bot.out.log'),
      `[${new Date().toISOString()}] Hermes bot process exited with code ${code}\n`,
      'utf8',
    );
  } catch {}
});
