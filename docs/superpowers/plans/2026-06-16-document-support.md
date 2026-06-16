# Document Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PDF, Word (.docx), and Excel (.xlsx) support to Hermes — parse locally via npm packages, summarise with AI, and enable in-session Q&A via per-chat document context.

**Architecture:** Single `bot.on('document', ...)` handler dispatches to `parseDocument(buffer, mimeType)` which routes to `pdf-parse` / `mammoth` / `xlsx`. Parsed text stored in `docContexts` Map and injected into `buildSystemPrompt()` for Q&A. Files ≤ 20 MB, text capped at 15 000 words.

**Tech Stack:** Node.js, Telegraf, pdf-parse, mammoth, xlsx, Jest

---

## File Map

| File | Change |
|------|---------|
| `bot/hermes-bot.js` | Add `docContexts` Map (line 55), extend `buildSystemPrompt()` (line 457), add `parseDocument()` helper (after line 1819), add `bot.on('document', ...)` handler (after line 1953), update `/reset` (line 1583), update `/help` (line 1550) |
| `package.json` | Add `pdf-parse`, `mammoth`, `xlsx` to `dependencies` |
| `__tests__/document.test.js` | New — unit tests for `parseDocument` helpers |

---

## Task 1: Install npm dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
npm install pdf-parse mammoth xlsx
```

- [ ] **Step 2: Verify they appear in package.json `dependencies`**

```bash
node -e "require('pdf-parse'); require('mammoth'); require('xlsx'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(docs): install pdf-parse, mammoth, xlsx"
```

---

## Task 2: Add `docContexts` Map and extend `buildSystemPrompt`

**Files:**
- Modify: `bot/hermes-bot.js` line 55 (Maps section) and line 457 (`buildSystemPrompt`)

- [ ] **Step 1: Add `docContexts` Map**

Find this block at line 51 in `bot/hermes-bot.js`:
```javascript
const histories = new Map();
const onboardingStates = new Map();
const chatProviders = new Map();
const chatAutoMode = new Map();
const lastPhotos = new Map(); // chatId → photo array (last received)
```

Add one line after `lastPhotos`:
```javascript
const histories = new Map();
const onboardingStates = new Map();
const chatProviders = new Map();
const chatAutoMode = new Map();
const lastPhotos = new Map(); // chatId → photo array (last received)
const docContexts = new Map(); // chatId → { text, fileName }
```

- [ ] **Step 2: Extend `buildSystemPrompt` to inject document context**

Find the end of `buildSystemPrompt` at line 518 in `bot/hermes-bot.js`:
```javascript
  return [
    base,
    `Профиль пользователя: имя - ${profile.name || 'не указано'}; основные задачи - ${profile.focus || 'не указано'}; стиль ответов - ${profile.tone || 'не указано'}.`,
  ].join(' ');
}
```

Replace with:
```javascript
  const docCtx = docContexts.get(chatId);
  const docSection = docCtx
    ? `\n\nКонтекст документа (файл: ${docCtx.fileName}):\n${docCtx.text}\n---\nПользователь может задавать вопросы по этому документу.`
    : '';

  return [
    base,
    `Профиль пользователя: имя - ${profile.name || 'не указано'}; основные задачи - ${profile.focus || 'не указано'}; стиль ответов - ${profile.tone || 'не указано'}.`,
  ].join(' ') + docSection;
}
```

- [ ] **Step 3: Run existing tests to confirm nothing broken**

```bash
npx jest __tests__/voice.test.js --testEnvironment=node --no-coverage
```

Expected: `8 passed, 0 failed`

- [ ] **Step 4: Commit**

```bash
git add bot/hermes-bot.js
git commit -m "feat(docs): add docContexts Map and inject into buildSystemPrompt"
```

---

## Task 3: Add `parseDocument` helper and unit tests

**Files:**
- Modify: `bot/hermes-bot.js` — after line 1819 (after `extractTranscription`)
- Create: `__tests__/document.test.js`

- [ ] **Step 1: Write failing tests**

Create `__tests__/document.test.js`:
```javascript
// Unit tests for document parsing pure helpers.

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function truncateToWords(text, maxWords) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ');
}

function xlsxToText(workbook) {
  const XLSX = { utils: { sheet_to_csv: (ws) => ws.__csv || '' } };
  return workbook.SheetNames
    .map(name => `[${name}]\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`)
    .join('\n\n');
}

describe('countWords', () => {
  it('counts words in normal text', () => {
    expect(countWords('hello world foo')).toBe(3);
  });

  it('handles extra whitespace', () => {
    expect(countWords('  hello   world  ')).toBe(2);
  });

  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });

  it('returns 0 for whitespace-only string', () => {
    expect(countWords('   ')).toBe(0);
  });
});

describe('truncateToWords', () => {
  it('returns text unchanged when under limit', () => {
    expect(truncateToWords('one two three', 5)).toBe('one two three');
  });

  it('returns text unchanged when exactly at limit', () => {
    expect(truncateToWords('one two three', 3)).toBe('one two three');
  });

  it('truncates to exactly maxWords words', () => {
    const result = truncateToWords('one two three four five', 3);
    expect(result).toBe('one two three');
    expect(countWords(result)).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests — expect PASS (self-contained logic)**

```bash
npx jest __tests__/document.test.js --testEnvironment=node --no-coverage
```

Expected:
```
PASS __tests__/document.test.js
  countWords
    ✓ counts words in normal text
    ✓ handles extra whitespace
    ✓ returns 0 for empty string
    ✓ returns 0 for whitespace-only string
  truncateToWords
    ✓ returns text unchanged when under limit
    ✓ returns text unchanged when exactly at limit
    ✓ truncates to exactly maxWords words

Tests: 7 passed, 7 total
```

- [ ] **Step 3: Add helpers and `parseDocument` to `bot/hermes-bot.js`**

Find this line at line 1819 in `bot/hermes-bot.js`:
```javascript
function extractTranscription(output) {
  return (
    typeof output === 'string' ? output :
    Array.isArray(output) ? (output[0] ?? '') :
    output?.text || ''
  ).trim();
}
```

Add immediately after the closing `}`:
```javascript
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function truncateToWords(text, maxWords) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ');
}

async function parseDocument(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    return workbook.SheetNames
      .map(name => `[${name}]\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`)
      .join('\n\n');
  }

  return null;
}
```

- [ ] **Step 4: Run all tests**

```bash
npx jest --testEnvironment=node --no-coverage
```

Expected: `15 passed, 0 failed` (8 voice + 7 document)

- [ ] **Step 5: Commit**

```bash
git add bot/hermes-bot.js __tests__/document.test.js
git commit -m "feat(docs): add parseDocument, countWords, truncateToWords helpers"
```

---

## Task 4: Add `bot.on('document', ...)` handler

**Files:**
- Modify: `bot/hermes-bot.js` — add after the `bot.on('voice', ...)` closing `});` at line 1953

- [ ] **Step 1: Add the document handler**

Find the closing of `bot.on('voice', ...)` at line 1953 in `bot/hermes-bot.js`:
```javascript
  } catch (error) {
    console.error('Voice transcription failed:', error);
    await reply(ctx, 'Не удалось транскрибировать голосовое сообщение. Попробуй ещё раз.');
  }
});

async function firecrawlScrape(url) {
```

Insert the new handler between the closing `});` and `async function firecrawlScrape`. The full block to insert:
```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add bot/hermes-bot.js
git commit -m "feat(docs): add bot.on('document') handler — PDF/Word/Excel parse + summarise + Q&A"
```

---

## Task 5: Update `/reset` and `/help`

**Files:**
- Modify: `bot/hermes-bot.js` lines 1583 (`/reset`) and 1550 (`/help`)

- [ ] **Step 1: Update `/reset` to clear docContexts**

Find at line 1583:
```javascript
bot.command('reset', async ctx => {
  histories.delete(ctx.chat.id);
  await reply(ctx, 'Память этого чата очищена.');
});
```

Replace with:
```javascript
bot.command('reset', async ctx => {
  histories.delete(ctx.chat.id);
  docContexts.delete(ctx.chat.id);
  await reply(ctx, 'Память и контекст документа очищены.');
});
```

- [ ] **Step 2: Add document line to `/help`**

Find at line 1550:
```javascript
      'голосовые сообщения — отправь голосовое, Гермес транскрибирует и ответит',
```

Add one line immediately after:
```javascript
      'голосовые сообщения — отправь голосовое, Гермес транскрибирует и ответит',
      'документы — пришли PDF, Word (.docx) или Excel (.xlsx), Гермес прочитает и ответит на вопросы',
```

- [ ] **Step 3: Run all tests**

```bash
npx jest --testEnvironment=node --no-coverage
```

Expected: `15 passed, 0 failed`

- [ ] **Step 4: Commit**

```bash
git add bot/hermes-bot.js
git commit -m "feat(docs): update /reset and /help to mention document support"
```

---

## Task 6: Integration test (manual)

- [ ] **Step 1: Start the bot**

```bash
npm run tg
```

Expected output includes: `Hermes Telegram bot is polling`

- [ ] **Step 2: Send a PDF**

Send any PDF file to the bot in Telegram.

Expected sequence:
```
Bot: 📄 Читаю документ...
Bot: 📝 Краткое содержание:
     [summary text]
Bot: 💬 Можешь задавать вопросы по документу.
```

Then send a follow-up question like "Какова основная тема?".

Expected: Bot answers using document content, not generic response.

- [ ] **Step 3: Test large document path**

Send a PDF with more than 15 000 words.

Expected:
```
Bot: 📄 Читаю документ...
Bot: ⚠️ Документ большой (~N слов), анализирую первые 15000.
Bot: 📝 Краткое содержание: [summary]
```

No "Можешь задавать вопросы" message (Q&A disabled for large docs).

- [ ] **Step 4: Test unsupported format**

Send a `.txt` or `.csv` file.

Expected:
```
Bot: Формат не поддерживается. Пришли PDF, Word (.docx) или Excel (.xlsx).
```

- [ ] **Step 5: Test /reset clears document context**

After loading a document, send `/reset`.

Expected: `Память и контекст документа очищены.`

Then ask "О чём был документ?" — bot should NOT use document context (generic answer).

- [ ] **Step 6: Test Word and Excel**

Send a `.docx` file and an `.xlsx` file.

Expected: Same flow as PDF — summary shown, Q&A offered.

- [ ] **Step 7: Verify /help shows document line**

Send `/help`.

Expected output includes:
```
документы — пришли PDF, Word (.docx) или Excel (.xlsx), Гермес прочитает и ответит на вопросы
```

- [ ] **Step 8: Push branch**

```bash
git push origin feat/voice-transcription
```
