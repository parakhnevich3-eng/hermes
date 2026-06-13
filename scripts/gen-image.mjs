import 'dotenv/config';

const key      = process.env.REPLICATE_API_KEY;
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId   = '21301948';
const prompt   = 'ресторан с видом на море, вечер, кинематографичный свет, фотореализм';

const delay = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log('Creating prediction...');
  const res = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro-ultra/predictions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'wait=60' },
    body: JSON.stringify({ input: { prompt, aspect_ratio: '16:9', output_format: 'jpg', safety_tolerance: 2 } }),
    signal: AbortSignal.timeout(70000),
  });
  const data = await res.json();
  if (!res.ok) { console.error('ERROR:', data.detail || data.title); process.exit(1); }
  console.log('Status:', data.status, '| ID:', data.id);

  let output = data.output;
  if (!output) {
    for (let i = 1; i <= 40; i++) {
      await delay(5000);
      const poll = await (await fetch(`https://api.replicate.com/v1/predictions/${data.id}`, {
        headers: { Authorization: `Bearer ${key}` },
      })).json();
      console.log(`Poll ${i}: ${poll.status}`);
      if (poll.status === 'succeeded') { output = poll.output; break; }
      if (poll.status === 'failed' || poll.status === 'canceled') throw new Error(poll.error);
    }
  }

  const url = Array.isArray(output) ? output[0] : output;
  if (!url) throw new Error('No output URL');
  console.log('URL:', url);

  const tg = await (await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, photo: url, caption: `FLUX 1.1 Pro Ultra\n${prompt}` }),
  })).json();
  console.log('Telegram:', tg.ok ? 'отправлено!' : JSON.stringify(tg));
}

run().catch(e => { console.error(e.message); process.exit(1); });
