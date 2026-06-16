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
  return `Создай красивый одностраничный сайт специально на тему: "${description}"

Требования:
- Уникальный дизайн, подходящий теме. Не используй шаблоны.
- В <head> обязательно: <meta charset="UTF-8"> и <link rel="stylesheet" href="/style.css">
- Весь CSS — в отдельном файле style.css, не inline и не в <style>

Верни ТОЛЬКО код в точном формате ниже (без пояснений, без markdown-блоков вроде \`\`\`):

<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/style.css">
  <title>...</title>
</head>
<body>
  <!-- контент сайта -->
</body>
</html>
--- STYLE.CSS ---
/* стили */
body { ... }`;
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

function sanitizeProjectName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 100) || 'my-site';
}

module.exports = { parseVdeployArgs, buildSitePrompt, parseSiteOutput, sanitizeProjectName };
