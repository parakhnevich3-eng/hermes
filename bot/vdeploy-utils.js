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
