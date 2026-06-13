import 'dotenv/config';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = '21301948';
const OR_KEY    = process.env.OPENROUTER_API_KEY;
const OR_URL    = 'https://openrouter.ai/api/v1/chat/completions';

const CLAUDE_MODEL     = process.env.CLAUDE_MODEL     || 'anthropic/claude-sonnet-4-5';
const QWEN_CODER_MODEL = process.env.QWEN_CODER_MODEL || 'qwen/qwen3.5-plus-20260420';

async function ask(model, prompt) {
  const res = await fetch(OR_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OR_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/hermes-bot',
      'X-Title': 'Hermes Bot',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  const msg = json?.choices?.[0]?.message;
  return (msg?.content || msg?.reasoning || '').trim();
}

async function sendTg(text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
  });
}

async function main() {
  // ── Тест 1: Реклама → Claude ──────────────────────────────────────────────
  console.log('Test 1: реклама → Claude...');
  await sendTg('🧪 <b>Тест роутинга #1</b>\nЗапрос: <i>"напиши рекламный пост про акцию — скидка 30% на бизнес-ланч в ресторане"</i>\nМодель: Claude Sonnet\n⏳ жду ответ...');

  try {
    const answer1 = await ask(
      CLAUDE_MODEL,
      'Напиши короткий продающий рекламный пост для Instagram: акция — скидка 30% на бизнес-ланч в ресторане. Стиль — живой, без клише. До 100 слов.'
    );
    await sendTg(`✅ <b>Claude Sonnet ответил:</b>\n\n${answer1}`);
  } catch (e) {
    await sendTg(`❌ Claude ошибка: ${e.message}`);
  }

  // ── Тест 2: Код → Qwen Coder ──────────────────────────────────────────────
  console.log('Test 2: код → Qwen Coder...');
  await sendTg('🧪 <b>Тест роутинга #2</b>\nЗапрос: <i>"напиши скрипт на Python для подсчёта среднего чека из CSV"</i>\nМодель: Qwen 3.5+\n⏳ жду ответ...');

  try {
    const answer2 = await ask(
      QWEN_CODER_MODEL,
      'Напиши короткий скрипт на Python: читает CSV с колонками date, amount, считает средний чек и выводит результат. Только код, без объяснений.'
    );
    await sendTg(`✅ <b>Qwen Coder ответил:</b>\n\n<code>${answer2.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`);
  } catch (e) {
    await sendTg(`❌ Qwen ошибка: ${e.message}`);
  }

  await sendTg('✅ <b>Роутинг работает.</b> Включи /auto — модели будут выбираться автоматически по смыслу запроса.');
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
