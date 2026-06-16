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
