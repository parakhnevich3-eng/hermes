# /vdeploy AI-Generated Sites Design

**Дата:** 2026-06-16  
**Статус:** Approved  
**Область:** `bot/hermes-bot.js` — команда `/vdeploy`

## Цель

Заменить захардкоженный HTML-шаблон Гермеса в команде `/vdeploy` на AI-генерацию кастомного сайта по описанию пользователя. Команда теперь всегда требует описание.

## Синтаксис команды

```
/vdeploy <name> <описание сайта>
```

Примеры:
```
/vdeploy surgut-food Сайт о ресторанах Сургута, тёмный стиль, русский язык
/vdeploy coffee-landing Лендинг для кофейни, светлый минималистичный дизайн
```

## Архитектура

```
/vdeploy surgut-food Сайт о ресторанах Сургута
    ↓
parseVdeployArgs(text)
  → name = "surgut-food"
  → description = "Сайт о ресторанах Сургута"
    ↓ (нет description → ошибка с примером использования)
reply(ctx, '⏳ Генерирую сайт «${name}»...')
    ↓
askAI(chatId, buildSitePrompt(description))
    ↓
parseSiteOutput(aiResponse)
  split on "--- STYLE.CSS ---"
  → html = часть до разделителя (trimmed)
  → css  = часть после разделителя (trimmed), или '' если разделитель не найден
    ↓ (html пустой → статическая ошибка)
vercelFetch POST /v13/deployments
  files: [
    { file: 'index.html', data: html },
    { file: 'style.css',  data: css  }   ← включается только если css не пустой
  ]
    ↓
reply: ✅ Сайт задеплоен! + name + URL + статус
```

## AI Prompt

```javascript
function buildSitePrompt(description) {
  return `Создай современный одностраничный сайт на тему: "${description}"

Верни ТОЛЬКО код, без пояснений, без markdown-блоков:
[полный index.html — в <head> обязательно: <link rel="stylesheet" href="/style.css">]
--- STYLE.CSS ---
[полный style.css]`;
}
```

Разделитель `--- STYLE.CSS ---` выбран как уникальный маркер, маловероятный в генерируемом коде.

## Парсинг аргументов

```javascript
function parseVdeployArgs(text) {
  const args = text.replace(/^\/vdeploy\s*/i, '').trim();
  const spaceIdx = args.indexOf(' ');
  if (spaceIdx === -1) return null; // только имя или пусто
  return {
    name: args.slice(0, spaceIdx),
    description: args.slice(spaceIdx + 1).trim(),
  };
}
```

Возвращает `null` если нет описания → ошибка пользователю.

## Парсинг AI-ответа

```javascript
function parseSiteOutput(output) {
  // strip markdown code fences — AI often wraps output despite instructions
  const stripped = output.replace(/^```[\w]*\r?\n?/gm, '').replace(/^```\r?\n?/gm, '');
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
```

Fallback: если разделитель не найден — весь ответ = `index.html`, CSS не деплоится.

## UX-флоу

### Успех

```
User:  /vdeploy surgut-food Сайт о ресторанах Сургута, тёмный стиль
Bot:   ⏳ Генерирую сайт «surgut-food»...
       [10-20 сек]
Bot:   ✅ Сайт задеплоен!

       surgut-food
       https://surgut-food-xxx.vercel.app

       Статус: BUILDING
```

### Ошибки

| Ситуация | Сообщение |
|----------|-----------|
| Нет имени или описания | `"Укажи имя и описание.\nПример: /vdeploy my-site Лендинг для кофейни, светлый стиль"` |
| AI вернул пустой ответ | `"Не удалось сгенерировать сайт. Попробуй ещё раз."` |
| Ошибка Vercel API | `"Не удалось задеплоить на Vercel. Попробуй ещё раз."` |

Все сообщения пользователю — статические строки. `error.message` не отображается.

## Затронутые файлы

- `bot/hermes-bot.js` — заменить блок `bot.command('vdeploy', ...)` (строки ~1421-1492)

## Новые вспомогательные функции

- `parseVdeployArgs(text)` → `{ name, description } | null`
- `buildSitePrompt(description)` → строка промпта
- `parseSiteOutput(output)` → `{ html, css }`

## Тесты

Новый файл `__tests__/vdeploy.test.js`:
- `parseVdeployArgs`: нет аргументов, только имя, имя + описание, многословное описание
- `parseSiteOutput`: с разделителем, без разделителя, пустой ответ, ответ в markdown-фенсах

## Что НЕ входит в эту задачу

- Диалоговый режим (бот спрашивает описание)
- Множество файлов (JS, изображения)
- Предпросмотр перед деплоем
- История задеплоенных сайтов
