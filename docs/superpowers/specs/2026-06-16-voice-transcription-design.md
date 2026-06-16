# Голосовые сообщения в Гермесе

**Дата:** 2026-06-16  
**Статус:** Approved  
**Область:** `bot/hermes-bot.js`

## Цель

Добавить поддержку голосовых сообщений в Telegram-бота Гермес: принимать OGG Opus аудио, транскрибировать через Replicate Whisper, передавать текст в AI-флоу.

## Архитектура

Добавляется один новый обработчик `bot.on('voice', ...)`. Вся инфраструктура переиспользуется из уже существующего кода.

```
voice message (OGG Opus)
    ↓
bot.on('voice', ctx)
    ↓
getTelegramFileUrl(ctx, fileId)    // новая обёртка, аналог getTelegramPhotoUrl() но принимает fileId напрямую
    ↓
downloadUrl(url)                   // уже есть в коде
    ↓
data:audio/ogg;base64,...          // аналогично uploadTelegramPhotoToReplicate()
    ↓
replicatePredict(voiceModel, { audio: base64url })
    ↓
transcription = output.text
    ↓
reply: "🎤 Слышу: <текст>"
    ↓
askAI(chatId, transcription)       // стандартный AI-флоу
    ↓
reply: ответ AI
```

## Конфигурация

Новая переменная окружения:

```
VOICE_MODEL=vaibhavs10/incredibly-fast-whisper
```

Значение по умолчанию — `vaibhavs10/incredibly-fast-whisper`. Добавляется рядом с `imageModel`, `videoModel`, `animateModel` в начале файла.

Требуется `REPLICATE_API_KEY` (уже используется для `/image`, `/video`, `/animate`).

## Replicate API

Модель: `vaibhavs10/incredibly-fast-whisper`  
Вход: `{ audio: "data:audio/ogg;base64,..." }`  
Выход: `{ text: "...", segments: [...], language: "..." }`

Используется существующая функция `replicatePredict(model, input)` без изменений.

## UX-сценарии

**Успех:**
1. Пользователь отправляет голосовое сообщение
2. Бот отвечает: `⏳ Транскрибирую...`
3. Бот отвечает: `🎤 Слышу: "[распознанный текст]"`
4. Бот отвечает: ответ AI на содержание сообщения

**Пустая транскрипция:**
→ `"Не удалось распознать речь. Попробуй ещё раз или напиши текстом."`

**Replicate не настроен (`REPLICATE_API_KEY` отсутствует):**
→ `"Голосовые сообщения не поддерживаются (REPLICATE_API_KEY не настроен)."`

**Ошибка Replicate:**
→ `"Не удалось транскрибировать: <сообщение ошибки>"`

## Что НЕ входит в эту задачу

- Аудио-файлы (`bot.on('audio')`) — только голосовые заметки (`voice`)
- Видео-заметки (`video_note`)
- Отправка голосового ответа от бота
- Документы (PDF/Word/Excel) — следующая итерация

## Затронутые файлы

- `bot/hermes-bot.js` — добавить `voiceModel`, `uploadTelegramVoiceToReplicate()`, `bot.on('voice', ...)`
- `.env.example` — добавить `VOICE_MODEL`
- `/help` — добавить упоминание голосовых сообщений

## Изменения в `/help` и `/health`

`/help` — добавить строку:  
`голосовые сообщения — отправь голосовое, Гермес транскрибирует и ответит`

`/health` — добавить строку:  
`Голос (Whisper): ${replicateApiKey ? 'подключён · ' + voiceModel : 'не настроен (нет REPLICATE_API_KEY)'}`
