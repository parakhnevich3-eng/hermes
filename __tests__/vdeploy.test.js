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
