// Unit tests for document parsing pure helpers.

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function truncateToWords(text, maxWords) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ');
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
