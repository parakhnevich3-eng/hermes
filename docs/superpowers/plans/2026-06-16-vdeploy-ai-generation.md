# /vdeploy AI Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded Hermes landing page in `/vdeploy` with AI-generated HTML + CSS based on user description.

**Architecture:** Two pure helper functions (`parseVdeployArgs`, `parseSiteOutput`) are extracted to `bot/vdeploy-utils.js` and tested in isolation. The `/vdeploy` command handler in `hermes-bot.js` is rewritten to call `askAI` with a prompt, parse the output, and deploy two files (`index.html` + `style.css`) to Vercel.

**Tech Stack:** Node.js, Telegraf, Vercel API, Jest

---

## File Map

| File | Change |
|------|---------|
| `bot/vdeploy-utils.js` | New — `parseVdeployArgs`, `buildSitePrompt`, `parseSiteOutput` |
| `bot/hermes-bot.js` | Add `require('./vdeploy-utils')` at top; replace `bot.command('vdeploy', ...)` block (lines 1422–1493) |
| `__tests__/vdeploy.test.js` | New — unit tests for the three pure helpers |

---

## Task 1: Helper functions + tests (TDD)

**Files:**
- Create: `bot/vdeploy-utils.js`
- Create: `__tests__/vdeploy.test.js`

- [ ] **Step 1: Write failing tests**

Create `__tests__/vdeploy.test.js`:

```javascript
const { parseVdeployArgs, buildSitePrompt, parseSiteOutput } = require('../bot/vdeploy-utils');

describe('parseVdeployArgs', () => {
  it('returns null for empty input', () => {
    expect(parseVdeployArgs('/vdeploy')).toBeNull();
    expect(parseVdeployArgs('/vdeploy   ')).toBeNull();
  });

  it('returns null when only project name given (no description)', () => {
    expect(parseVdeployArgs('/vdeploy my-site')).toBeNull();
  });

  it('parses name and description', () => {
    expect(parseVdeployArgs('/vdeploy my-site Лендинг для кофейни')).toEqual({
      name: 'my-site',
      description: 'Лендинг для кофейни',
    });
  });

  it('handles multi-word description', () => {
    const result = parseVdeployArgs('/vdeploy surgut-food Сайт о ресторанах Сургута, тёмный стиль');
    expect(result).toEqual({
      name: 'surgut-food',
      description: 'Сайт о ресторанах Сургута, тёмный стиль',
    });
  });
});

describe('parseSiteOutput', () => {
  it('splits html and css on delimiter', () => {
    const input = '<html>content</html>\n--- STYLE.CSS ---\nbody { color: red; }';
    const result = parseSiteOutput(input);
    expect(result.html).toBe('<html>content</html>');
    expect(result.css).toBe('body { color: red; }');
  });

  it('returns full output as html when delimiter is missing', () => {
    const input = '<html>content</html>';
    const result = parseSiteOutput(input);
    expect(result.html).toBe('<html>content</html>');
    expect(result.css).toBe('');
  });

  it('strips markdown code fences from html', () => {
    const input = '```html\n<html>content</html>\n```\n--- STYLE.CSS ---\n```css\nbody{}\n```';
    const result = parseSiteOutput(input);
    expect(result.html).toBe('<html>content</html>');
    expect(result.css).toBe('body{}');
  });

  it('returns empty html and css for empty input', () => {
    const result = parseSiteOutput('');
    expect(result.html).toBe('');
    expect(result.css).toBe('');
  });
});

describe('buildSitePrompt', () => {
  it('includes the description in the prompt', () => {
    const prompt = buildSitePrompt('Сайт о ресторанах');
    expect(prompt).toContain('Сайт о ресторанах');
    expect(prompt).toContain('--- STYLE.CSS ---');
    expect(prompt).toContain('style.css');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```bash
npx jest __tests__/vdeploy.test.js --testEnvironment=node --no-coverage
```

Expected: FAIL with `Cannot find module '../bot/vdeploy-utils'`

- [ ] **Step 3: Create `bot/vdeploy-utils.js`**

```javascript
function parseVdeployArgs(text) {
  const args = text.replace(/^\/vdeploy\s*/i, '').trim();
  const spaceIdx = args.indexOf(' ');
  if (spaceIdx === -1) return null;
  const description = args.slice(spaceIdx + 1).trim();
  if (!description) return null;
  return {
    name: args.slice(0, spaceIdx),
    description,
  };
}

function buildSitePrompt(description) {
  return `Создай современный одностраничный сайт на тему: "${description}"

Верни ТОЛЬКО код, без пояснений, без markdown-блоков:
[полный index.html — в <head> обязательно: <link rel="stylesheet" href="/style.css">]
--- STYLE.CSS ---
[полный style.css]`;
}

function parseSiteOutput(output) {
  const stripped = output
    .replace(/^```[\w]*\r?\n?/gm, '')
    .replace(/^```\r?\n?/gm, '');
  const DELIMITER = '--- STYLE.CSS ---';
  const idx = stripped.indexOf(DELIMITER);
  if (idx === -1) {
    return { html: stripped.trim(), css: '' };
  }
  return {
    html: stripped.slice(0, idx).trim(),
    css: stripped.slice(idx + DELIMITER.length).trim(),
  };
}

module.exports = { parseVdeployArgs, buildSitePrompt, parseSiteOutput };
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest __tests__/vdeploy.test.js --testEnvironment=node --no-coverage
```

Expected:
```
PASS __tests__/vdeploy.test.js
  parseVdeployArgs
    ✓ returns null for empty input
    ✓ returns null when only project name given (no description)
    ✓ parses name and description
    ✓ handles multi-word description
  parseSiteOutput
    ✓ splits html and css on delimiter
    ✓ returns full output as html when delimiter is missing
    ✓ strips markdown code fences from html
    ✓ returns empty html and css for empty input
  buildSitePrompt
    ✓ includes the description in the prompt

Tests: 9 passed, 9 total
```

- [ ] **Step 5: Run all tests — confirm no regressions**

```bash
npx jest --testEnvironment=node --no-coverage
```

Expected: `25 passed, 0 failed` (16 existing + 9 new)

- [ ] **Step 6: Commit**

```bash
git add bot/vdeploy-utils.js __tests__/vdeploy.test.js
git commit -m "feat(vdeploy): add parseVdeployArgs, buildSitePrompt, parseSiteOutput helpers"
```

---

## Task 2: Rewrite `/vdeploy` command handler

**Files:**
- Modify: `bot/hermes-bot.js` — add import at line ~8, replace command block at lines 1422–1493

- [ ] **Step 1: Add import at top of `bot/hermes-bot.js`**

Find the existing `require('./document-utils')` line near the top of `bot/hermes-bot.js`:
```javascript
const { countWords, truncateToWords, parseDocument } = require('./document-utils');
```

Add immediately after it:
```javascript
const { parseVdeployArgs, buildSitePrompt, parseSiteOutput } = require('./vdeploy-utils');
```

- [ ] **Step 2: Replace the `/vdeploy` command handler**

Find this entire block in `bot/hermes-bot.js` (lines 1422–1493):
```javascript
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
```

Replace the entire block with:
```javascript
bot.command('vdeploy', async ctx => {
  if (!vercelToken) {
    await reply(ctx, 'VERCEL_API_TOKEN не настроен.');
    return;
  }

  const parsed = parseVdeployArgs(ctx.message.text);
  if (!parsed) {
    await reply(ctx, 'Укажи имя и описание.\nПример: /vdeploy my-site Лендинг для кофейни, светлый стиль');
    return;
  }

  const { name, description } = parsed;
  await sendChatAction(ctx, 'typing');
  await reply(ctx, `⏳ Генерирую сайт «${name}»...`);

  try {
    const aiOutput = await askAI(ctx.chat.id, buildSitePrompt(description));

    // Remove AI output from chat history — it's a one-shot generation, not Q&A
    const hist = getChatHistory(ctx.chat.id);
    hist.splice(-2, 2);

    const { html, css } = parseSiteOutput(aiOutput);

    if (!html) {
      await reply(ctx, 'Не удалось сгенерировать сайт. Попробуй ещё раз.');
      return;
    }

    const files = [{ file: 'index.html', data: html }];
    if (css) files.push({ file: 'style.css', data: css });

    const data = await vercelFetch('/v13/deployments', {
      method: 'POST',
      body: JSON.stringify({
        name,
        files,
        projectSettings: { framework: null },
        target: 'production',
      }),
    });

    const deployUrl = `https://${data.url}`;
    await reply(ctx, `✅ Сайт задеплоен!\n\n${data.name}\n${deployUrl}\n\nСтатус: ${data.readyState || 'BUILDING'}`);
  } catch (error) {
    console.error('vdeploy failed:', error);
    await reply(ctx, 'Не удалось задеплоить на Vercel. Попробуй ещё раз.');
  }
});
```

- [ ] **Step 3: Run all tests — confirm no regressions**

```bash
npx jest --testEnvironment=node --no-coverage
```

Expected: `25 passed, 0 failed`

- [ ] **Step 4: Commit**

```bash
git add bot/hermes-bot.js
git commit -m "feat(vdeploy): replace hardcoded template with AI-generated HTML+CSS"
```

---

## Task 3: Update `/help`

**Files:**
- Modify: `bot/hermes-bot.js` — `/help` handler

- [ ] **Step 1: Update the `/vdeploy` help line**

Find this line in the `bot.help(...)` handler:
```javascript
      '/vdeploy <name> - задеплоить лендинг Гермеса',
```

Replace with:
```javascript
      '/vdeploy <name> <описание> - сгенерировать и задеплоить сайт (AI + Vercel)',
```

- [ ] **Step 2: Run all tests**

```bash
npx jest --testEnvironment=node --no-coverage
```

Expected: `25 passed, 0 failed`

- [ ] **Step 3: Commit**

```bash
git add bot/hermes-bot.js
git commit -m "feat(vdeploy): update /help to reflect new AI-generation syntax"
```

---

## Task 4: Integration test (manual)

- [ ] **Step 1: Start the bot**

```bash
npm run tg
```

Expected: `Hermes Telegram bot is polling`

- [ ] **Step 2: Test with description**

Send to bot:
```
/vdeploy test-coffee Лендинг для кофейни, светлый минималистичный стиль, русский язык
```

Expected sequence:
```
Bot: ⏳ Генерирую сайт «test-coffee»...   (мгновенно)
Bot: ✅ Сайт задеплоен!                   (через 15-30 сек)
     test-coffee
     https://test-coffee-xxx.vercel.app
     Статус: BUILDING
```

Open the URL — should show a coffee shop landing page, not the Hermes template.

- [ ] **Step 3: Test without description**

Send: `/vdeploy just-a-name`

Expected:
```
Bot: Укажи имя и описание.
     Пример: /vdeploy my-site Лендинг для кофейни, светлый стиль
```

- [ ] **Step 4: Verify /help updated**

Send `/help` — find the line:
```
/vdeploy <name> <описание> - сгенерировать и задеплоить сайт (AI + Vercel)
```

- [ ] **Step 5: Push branch**

```bash
git push origin feat/voice-transcription
```
