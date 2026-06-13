import 'dotenv/config';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = '21301948';
const OR_KEY    = process.env.OPENROUTER_API_KEY;

const OPENROUTER_MODEL  = process.env.OPENROUTER_MODEL    || 'deepseek/deepseek-v4-pro';
const MINIMAX_MODEL     = process.env.MINIMAX_MODEL       || 'minimax/minimax-01';
const CLAUDE_MODEL      = process.env.CLAUDE_MODEL        || 'anthropic/claude-sonnet-4-5';
const GEMINI_MODEL      = process.env.GEMINI_MODEL        || 'google/gemini-2.5-pro-preview';
const GROK_MODEL        = process.env.GROK_MODEL          || 'x-ai/grok-3';
const QWEN_CODER_MODEL  = process.env.QWEN_CODER_MODEL    || 'qwen/qwen-2.5-coder-32b-instruct';
const DEEPSEEK_R1_MODEL = process.env.DEEPSEEK_R1_MODEL   || 'deepseek/deepseek-r1';

// ─── Routing logic (mirrors hermes-bot.js detectProvider) ───────────────────
function detectProvider(message) {
  const t = message.toLowerCase();
  if (/найди\b|поищи\b|погугли|что сейчас|актуальн|последние новости|в 2025|в 2026|сколько стоит|цены на|что у конкурент/.test(t)) return 'perplexity';
  if (message.length > 1500) return 'minimax';
  if (/```[\s\S]/.test(message)) return /проверь|найди баг|почему|ошибк|не работает|исправь/.test(t) ? 'deepseek-r1' : 'qwen-coder';
  if (/напиши (код|скрипт|функци|класс|модул)|сделай скрипт|создай (функц|скрипт|компонент|интеграц)|автоматизируй|implement/.test(t)) return 'qwen-coder';
  if (/проверь код|найди баг|дебаг|ошибка в коде|почему не работает|review код|отладк|что не так с/.test(t)) return 'deepseek-r1';
  if (/вот документ|весь файл|полный отчёт|таблиц|прайс-лист|большой текст/.test(t)) return 'minimax';
  if (/инстаграм|instagram|reels|сторис|stories|пост для тг|пост в тг|тикток|tiktok|вирусн|мем\b|smm|контент для соцсет/.test(t)) return 'grok';
  if (/реклам|объявлени|слоган|оффер|продающ|текст для|описани блюд|текст меню|акци\b|скидк|лендинг|landing|email.рассылк|письмо клиент|баннер/.test(t)) return 'claude';
  if (/стратег|маркетинг.план|контент.план|анализ рынка|целевая аудитор|сегментац|позиционирован|конкурент|kpi|метрик|аналитик рынк|исследовани/.test(t)) return 'gemini';
  return 'openrouter';
}

// ─── Routing test cases ──────────────────────────────────────────────────────
const ROUTING_TESTS = [
  { msg: 'найди актуальные цены на доставку еды в Сургуте',              expect: 'perplexity'   },
  { msg: 'A'.repeat(1600),                                                expect: 'minimax'      },
  { msg: 'напиши скрипт для выгрузки отчёта из iiko в Excel',            expect: 'qwen-coder'   },
  { msg: 'проверь код, найди баг\n```js\nconst x = underfined\n```',     expect: 'deepseek-r1'  },
  { msg: 'сделай вирусный пост для инстаграм нашего ресторана',           expect: 'grok'         },
  { msg: 'напиши текст акции — скидка 20% на все пиццы в субботу',       expect: 'claude'       },
  { msg: 'составь маркетинг-план на квартал с анализом конкурентов',      expect: 'gemini'       },
  { msg: 'вот таблица продаж за май, проанализируй',                     expect: 'minimax'      },
  { msg: 'привет, как дела?',                                             expect: 'openrouter'   },
];

// ─── Live LLM probes (one short ping per provider) ──────────────────────────
const PROBE_PROMPT = 'Скажи "да, работаю" — это тестовый пинг.';
const PROBES = [
  { key: 'openrouter',    model: OPENROUTER_MODEL  },
  { key: 'claude',        model: CLAUDE_MODEL      },
  { key: 'gemini',        model: GEMINI_MODEL      },
  { key: 'grok',          model: GROK_MODEL        },
  { key: 'qwen-coder',    model: QWEN_CODER_MODEL  },
  { key: 'deepseek-r1',   model: DEEPSEEK_R1_MODEL },
  { key: 'minimax',       model: MINIMAX_MODEL     },
];

async function probeModel(model) {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OR_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/hermes-bot',
        'X-Title': 'Hermes Bot',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: PROBE_PROMPT }],
        max_tokens: 100,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, err: `HTTP ${res.status}` };
    const answer = json?.choices?.[0]?.message?.content?.trim() || '(пусто)';
    return { ok: true, answer };
  } catch (e) {
    return { ok: false, err: e.message };
  }
}

async function sendTg(text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
  });
}

// ─── Run ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Running orchestration test...');
  await sendTg('🔧 <b>Тест оркестрации Гермеса запущен...</b>');

  // 1. Routing tests
  let routingLines = ['<b>Роутинг (авто-выбор модели):</b>', ''];
  let routingPass = 0;
  for (const { msg, expect } of ROUTING_TESTS) {
    const got = detectProvider(msg);
    const ok  = got === expect;
    if (ok) routingPass++;
    const preview = msg.length > 50 ? msg.slice(0, 47) + '...' : msg;
    routingLines.push(`${ok ? '✅' : '❌'} ${expect.padEnd(12)} → ${ok ? 'OK' : `GOT: ${got}`}`);
    routingLines.push(`   <i>${preview}</i>`);
  }
  routingLines.push('');
  routingLines.push(`Итог: ${routingPass}/${ROUTING_TESTS.length} пройдено`);
  await sendTg(routingLines.join('\n'));

  // 2. Live model probes
  await sendTg('⏳ Проверяю живые модели...');
  const probeLines = ['<b>Доступность моделей (OpenRouter):</b>', ''];

  for (const { key, model } of PROBES) {
    process.stdout.write(`  pinging ${key}...`);
    const { ok, answer, err } = await probeModel(model);
    const short = model.split('/')[1] || model;
    probeLines.push(`${ok ? '✅' : '❌'} <b>${key}</b> (${short})`);
    if (ok)  probeLines.push(`   → ${answer}`);
    if (!ok) probeLines.push(`   → ${err}`);
    console.log(ok ? ` OK: ${answer}` : ` FAIL: ${err}`);
  }

  await sendTg(probeLines.join('\n'));
  await sendTg([
    '✅ <b>Тест завершён.</b>',
    '',
    'Чтобы включить авто-роутинг: /auto',
    'Переключить модель вручную: /provider',
  ].join('\n'));

  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
