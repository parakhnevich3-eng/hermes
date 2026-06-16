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

module.exports = { countWords, truncateToWords, parseDocument };
