// Preload ONLY in the local dashboard integration-test server. Never use secrets.
if (!['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname) ||
    process.env.TELEGRAM_BOT_TOKEN !== '123:offline' || process.env.TELEGRAM_CHAT_ID !== '-100123') {
  throw Error('LOCAL_SYNTHETIC_PUBLISH_TEST_REQUIRED');
}
const originalFetch = globalThis.fetch;
let sends = 0;
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input));
  if (['localhost', '127.0.0.1'].includes(url.hostname)) return originalFetch(input, options);
  if (url.href !== 'https://api.telegram.org/bot123:offline/sendMessage') throw Error('EXTERNAL_NETWORK_BLOCKED');
  const body = JSON.parse(options.body);
  if (body.chat_id !== '-100123' || body.allow_paid_broadcast !== false || ++sends !== 1) throw Error('INVALID_OR_DUPLICATE_TEST_SEND');
  return Response.json({ok:true,result:{message_id:777,chat:{id:-100123}}});
};
