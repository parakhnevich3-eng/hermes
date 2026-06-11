require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const { inspect } = require('util');
const { Telegraf } = require('telegraf');

const token = process.env.TELEGRAM_BOT_TOKEN;
const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
const deepseekModel = process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro';
const deepseekBaseUrl = (
  process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
).replace(/\/+$/, '');
const perplexityApiKey = process.env.PERPLEXITY_API_KEY;
const perplexityModel = process.env.PERPLEXITY_MODEL || 'sonar-pro';
const perplexityBaseUrl = 'https://api.perplexity.ai';
const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;
const firecrawlBaseUrl = 'https://api.firecrawl.dev';
const githubToken = process.env.GITHUB_TOKEN;
const githubBaseUrl = 'https://api.github.com';
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
function getChatProvider(chatId) {
  return chatProviders.get(chatId) || 'deepseek';
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
  const identity = provider === 'perplexity'
    ? `Я работаю через Perplexity AI API, модель: ${perplexityModel}. Я не Claude и не модель Anthropic.`
    : `Я работаю через DeepSeek API, модель: ${deepseekModel}. Я не Claude и не модель Anthropic.`;

  const tools = [
    'Инструменты Гермеса (встроенные команды):',
    '/web <запрос> — поиск в интернете через Perplexity AI с источниками;',
    `/scrape <url> — скрапинг любой веб-страницы через Firecrawl API (${firecrawlApiKey ? 'подключён' : 'не настроен'});`,
    '/myrepos, /myissues, /myprs — GitHub интеграция (личные репозитории и задачи);',
    '/repo, /issues, /pr — публичные GitHub репозитории.',
    'Если пользователь спрашивает о Firecrawl, веб-скрапинге или подключении к сервисам — отвечай на основе этих данных, не говори что ты не можешь делать запросы.',
  ].join(' ');

  const base = [
    'Ты Гермес, дружелюбный Telegram-помощник.',
    'Гермес - это имя продукта, а не роль: не отыгрывай мифологического персонажа и не используй обращения вроде "смертный".',
    identity,
    tools,
    'Если пользователь спрашивает, какая ты модель или кто под капотом, отвечай именно этой информацией.',
    'Никогда не называй себя Claude, Anthropic, ChatGPT или OpenAI-моделью.',
    'Отвечай по-русски, если пользователь не попросил другой язык.',
    'Будь полезным, ясным и не слишком многословным.',
  ].join(' ');

  const profile = getProfile(chatId);

  if (!profile) {
    return [base, 'Если пользователь выглядит новым, мягко предложи команду /onboarding.'].join(' ');
  }

  return [
    base,
    `Профиль пользователя: имя - ${profile.name || 'не указано'}; основные задачи - ${profile.focus || 'не указано'}; стиль ответов - ${profile.tone || 'не указано'}.`,
  ].join(' ');
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
    normalized.includes('perplexity')
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

async function askAI(chatId, userMessage) {
  const provider = getChatProvider(chatId);
  if (provider === 'perplexity') {
    return askPerplexity(chatId, userMessage);
  }
  return askDeepSeek(chatId, userMessage);
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
  const modelLabel = provider === 'perplexity' ? perplexityModel : deepseekModel;
  const providerLabel = provider === 'perplexity' ? 'Perplexity AI' : 'DeepSeek';
  await reply(
    ctx,
    [
      'Гермес на связи.',
      '',
      `Сейчас я отвечаю через ${providerLabel} (${modelLabel}).`,
      'Профиль уже настроен. Команды: /help, /ping, /reset, /provider, /profile, /model, /onboarding, /whoami.',
    ].join('\n'),
  );
});

bot.help(async ctx => {
  const provider = getChatProvider(ctx.chat.id);
  const modelLabel = provider === 'perplexity' ? perplexityModel : deepseekModel;
  await reply(
    ctx,
    [
      `Гермес сейчас работает как Telegram-бот на ${modelLabel}.`,
      '',
      '/start - начать',
      '/ping - проверить, что бот живой',
      '/reset - очистить память этого чата',
      '/web <запрос> - поиск в интернете через Perplexity (с источниками)',
      '/scrape <url> - скрапить страницу и получить её содержимое',
      '/myrepos - твои репозитории на GitHub',
      '/myissues - твои открытые issues',
      '/myprs - твои открытые pull requests',
      '/repo owner/repo - информация о любом репозитории GitHub',
      '/issues owner/repo - открытые issues репозитория',
      '/pr owner/repo - открытые pull requests',
      '/stats - расходы на AI (токены, деньги, модели)',
      '/provider - переключить провайдера (DeepSeek ↔ Perplexity)',
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
  const next = current === 'deepseek' ? 'perplexity' : 'deepseek';

  if (next === 'perplexity' && !perplexityApiKey) {
    await reply(ctx, 'PERPLEXITY_API_KEY не настроен. Добавьте ключ в .env и перезапустите бота.');
    return;
  }

  setChatProvider(ctx.chat.id, next);
  histories.delete(ctx.chat.id);

  const label = next === 'perplexity'
    ? `Perplexity AI (${perplexityModel})`
    : `DeepSeek (${deepseekModel})`;
  await reply(ctx, `Переключено на ${label}. История чата очищена.`);
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
      `Perplexity: ${perplexityApiKey ? `подключен · ${perplexityModel}` : 'не настроен'}`,
      `Firecrawl: ${firecrawlApiKey ? 'подключен · /scrape доступен' : 'не настроен'}`,
      `GitHub: ${githubToken ? 'подключен · /myrepos /myissues /myprs' : 'без токена (только публичные repo)'}`,
      `Профиль: ${getProfile(ctx.chat.id) ? 'настроен' : 'не настроен'}`,
    ].join('\n'),
  );
});

bot.action(/^onboarding_tone:(short|detailed|steps)$/, async ctx => {
  await answerCallback(ctx);
  await finishOnboarding(ctx, ctx.match[1]);
});

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

  await sendChatAction(ctx, 'typing');

  try {
    const answer = await askAI(ctx.chat.id, message);
    await replyLong(ctx, answer);
  } catch (error) {
    console.error('DeepSeek request failed:', error);
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
