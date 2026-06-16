# Voice Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add voice message handling to Hermes — download OGG audio from Telegram, transcribe via Replicate Whisper, pipe transcription into existing `askAI()` flow.

**Architecture:** Single `bot.on('voice', ...)` handler reuses existing `downloadUrl()` and `replicatePredict()` infrastructure. Two new helpers added: `uploadTelegramVoiceToReplicate()` (mirrors `uploadTelegramPhotoToReplicate`) and `extractTranscription()` (normalises Replicate output). Zero new dependencies.

**Tech Stack:** Node.js, Telegraf, Replicate API (`vaibhavs10/incredibly-fast-whisper`), Jest

---

## File Map

| File | Change |
|------|--------|
| `bot/hermes-bot.js` | Add `voiceModel` const (line 30), two helpers (after line 1802), voice handler (after line 1888), update `/help` (line 1549) and `/health` (line 2032) |
| `.env.example` | Add `REPLICATE_API_KEY` and `VOICE_MODEL` entries |
| `__tests__/voice.test.js` | New — unit tests for pure helper logic |

---

## Task 1: Add `voiceModel` config constant

**Files:**
- Modify: `bot/hermes-bot.js` line 30
- Modify: `.env.example`

- [ ] **Step 1: Insert `voiceModel` constant**

In `bot/hermes-bot.js`, find line 30:
```javascript
const animateModel     = process.env.ANIMATE_MODEL || 'luma/ray-3.2';
```

Add immediately after (before `const replicateBaseUrl`):
```javascript
const voiceModel       = process.env.VOICE_MODEL   || 'vaibhavs10/incredibly-fast-whisper';
```

- [ ] **Step 2: Add missing entries to `.env.example`**

Add these lines at the end of `.env.example`:
```
OPENROUTER_API_KEY=sk-or-replace_this_from_openrouter
OPENROUTER_MODEL=deepseek/deepseek-v4-pro
REPLICATE_API_KEY=r8_replace_this_from_replicate
IMAGE_MODEL=black-forest-labs/flux-1.1-pro-ultra
VIDEO_MODEL=minimax/video-01
ANIMATE_MODEL=luma/ray-3.2
VOICE_MODEL=vaibhavs10/incredibly-fast-whisper
FIRECRAWL_API_KEY=fc-replace_this_from_firecrawl
HERMES_LOG_TO_FILES=false
TELEGRAM_DELIVERY_RETRIES=6
TELEGRAM_OUTBOX_RETRIES=60
```

- [ ] **Step 3: Commit**

```bash
git add bot/hermes-bot.js .env.example
git commit -m "feat(voice): add VOICE_MODEL config constant"
```

---

## Task 2: Add helper functions and tests

**Files:**
- Modify: `bot/hermes-bot.js` — after line 1802
- Create: `__tests__/voice.test.js`

- [ ] **Step 1: Write failing tests**

Create `__tests__/voice.test.js`:
```javascript
// Unit tests for voice transcription pure helpers.
// These validate logic that will be inlined into hermes-bot.js.

// Mirrors the data URL builder that will live in uploadTelegramVoiceToReplicate
function buildVoiceDataUrl(buffer) {
  return `data:audio/ogg;base64,${buffer.toString('base64')}`;
}

// Mirrors extractTranscription() that will be added to hermes-bot.js
function extractTranscription(output) {
  return (
    typeof output === 'string' ? output :
    Array.isArray(output) ? output[0] :
    output?.text || ''
  ).trim();
}

describe('buildVoiceDataUrl', () => {
  it('produces a valid ogg base64 data URL', () => {
    const buf = Buffer.from('fake-audio');
    const result = buildVoiceDataUrl(buf);
    expect(result).toMatch(/^data:audio\/ogg;base64,/);
    expect(result).toBe(`data:audio/ogg;base64,${buf.toString('base64')}`);
  });

  it('handles empty buffer', () => {
    const result = buildVoiceDataUrl(Buffer.alloc(0));
    expect(result).toBe('data:audio/ogg;base64,');
  });
});

describe('extractTranscription', () => {
  it('extracts .text from Whisper object output', () => {
    expect(extractTranscription({ text: ' hello world', segments: [] })).toBe('hello world');
  });

  it('trims whitespace', () => {
    expect(extractTranscription({ text: '  spaced  ' })).toBe('spaced');
  });

  it('handles string output', () => {
    expect(extractTranscription('direct string')).toBe('direct string');
  });

  it('handles array output (takes first element)', () => {
    expect(extractTranscription(['first', 'second'])).toBe('first');
  });

  it('returns empty string for null/undefined', () => {
    expect(extractTranscription(null)).toBe('');
    expect(extractTranscription(undefined)).toBe('');
    expect(extractTranscription({ text: '' })).toBe('');
  });
});
```

- [ ] **Step 2: Run tests — expect PASS (logic is self-contained)**

```bash
npx jest __tests__/voice.test.js --testEnvironment=node --no-coverage
```

Expected output:
```
PASS __tests__/voice.test.js
  buildVoiceDataUrl
    ✓ produces a valid ogg base64 data URL
    ✓ handles empty buffer
  extractTranscription
    ✓ extracts .text from Whisper object output
    ✓ trims whitespace
    ✓ handles string output
    ✓ handles array output (takes first element)
    ✓ returns empty string for null/undefined

Tests: 7 passed, 7 total
```

- [ ] **Step 3: Add helpers to `bot/hermes-bot.js`**

Find line 1802 (end of `uploadTelegramPhotoToReplicate`):
```javascript
async function uploadTelegramPhotoToReplicate(ctx, photoArray) {
  const tgUrl = await getTelegramPhotoUrl(ctx, photoArray);
  const imageBuffer = await downloadUrl(tgUrl);
  return `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
}
```

Add immediately after:
```javascript
async function uploadTelegramVoiceToReplicate(ctx, fileId) {
  const file = await ctx.telegram.getFile(fileId);
  const tgUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const audioBuffer = await downloadUrl(tgUrl);
  return `data:audio/ogg;base64,${audioBuffer.toString('base64')}`;
}

function extractTranscription(output) {
  return (
    typeof output === 'string' ? output :
    Array.isArray(output) ? output[0] :
    output?.text || ''
  ).trim();
}
```

- [ ] **Step 4: Commit**

```bash
git add bot/hermes-bot.js __tests__/voice.test.js
git commit -m "feat(voice): add uploadTelegramVoiceToReplicate and extractTranscription helpers"
```

---

## Task 3: Add `bot.on('voice')` handler

**Files:**
- Modify: `bot/hermes-bot.js` — after `bot.on('photo', ...)` handler (after line 1888)

- [ ] **Step 1: Add the voice handler**

Find the closing `});` of `bot.on('photo', ...)` (~line 1888):
```javascript
  // Hint
  if (replicateApiKey) {
    await reply(ctx, 'Фото получено. Напиши /animate чтобы оживить его.');
  }
});
```

Add immediately after that closing `});`:
```javascript
bot.on('voice', async ctx => {
  if (!isAuthorized(ctx)) return;

  if (!replicateApiKey) {
    await reply(ctx, 'Голосовые сообщения не поддерживаются (REPLICATE_API_KEY не настроен).');
    return;
  }

  if (!getProfile(ctx.chat.id)) {
    await startOnboarding(ctx);
    return;
  }

  await reply(ctx, '⏳ Транскрибирую...');

  try {
    const audioUrl = await uploadTelegramVoiceToReplicate(ctx, ctx.message.voice.file_id);
    const output = await replicatePredict(voiceModel, { audio: audioUrl });
    const transcription = extractTranscription(output);

    if (!transcription) {
      await reply(ctx, 'Не удалось распознать речь. Попробуй ещё раз или напиши текстом.');
      return;
    }

    await reply(ctx, `🎤 Слышу: "${transcription}"`);
    await sendChatAction(ctx, 'typing');

    const answer = await askAI(ctx.chat.id, transcription);
    await replyLong(ctx, answer);
  } catch (error) {
    console.error('Voice transcription failed:', error);
    await reply(ctx, `Не удалось транскрибировать: ${error.message}`);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add bot/hermes-bot.js
git commit -m "feat(voice): add bot.on('voice') handler — Replicate Whisper transcription"
```

---

## Task 4: Update `/help` and `/health`

**Files:**
- Modify: `bot/hermes-bot.js` — `/help` (~line 1549) and `/health` (~line 2032)

- [ ] **Step 1: Update `/help`**

Find this line (~line 1549):
```javascript
      '/image <описание> - сгенерировать изображение (FLUX 1.1 Pro Ultra)',
```

Add immediately before it:
```javascript
      'голосовые сообщения — отправь голосовое, Гермес транскрибирует и ответит',
```

- [ ] **Step 2: Update `/health`**

Find this line (~line 2032):
```javascript
      `Replicate: ${replicateApiKey ? `подключен · /image · /video · /animate (${animateModel})` : 'не настроен'}`,
```

Replace with:
```javascript
      `Replicate: ${replicateApiKey ? `подключен · /image · /video · /animate (${animateModel}) · голос (${voiceModel})` : 'не настроен'}`,
```

- [ ] **Step 3: Commit**

```bash
git add bot/hermes-bot.js
git commit -m "feat(voice): update /help and /health to mention voice support"
```

---

## Task 5: Integration test (manual)

- [ ] **Step 1: Start the bot**

```bash
cd /d/CODING/openclaw3/Andrei4eg
npm run tg
```

Bot should print: `Hermes Telegram bot is polling as @andrei4eg_bot ...`

- [ ] **Step 2: Send voice message**

Open Telegram → find your bot → hold microphone and say «Привет, как дела».

Expected sequence (timing approximate):
```
User:  [voice message]
Bot:   ⏳ Транскрибирую...          (< 2 сек)
Bot:   🎤 Слышу: "Привет, как дела" (10–20 сек — Replicate polling)
Bot:   [AI ответ на транскрипцию]
```

- [ ] **Step 3: Verify /health output**

Send `/health` to bot.

Expected Replicate line:
```
Replicate: подключен · /image · /video · /animate (luma/ray-3.2) · голос (vaibhavs10/incredibly-fast-whisper)
```

- [ ] **Step 4: Test edge case — empty transcription**

Send very short voice (less than 0.5 sec of silence).

Expected:
```
Bot: Не удалось распознать речь. Попробуй ещё раз или напиши текстом.
```

- [ ] **Step 5: Run full unit test suite**

```bash
npx jest __tests__/voice.test.js --testEnvironment=node --no-coverage
```

Expected: 7 passed, 0 failed.
