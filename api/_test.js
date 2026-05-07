// Sanity-check endpoint. GET /api/_test → reports which providers have keys configured
// and whether each one responds to a tiny prompt.

import { callAI, providerStatus } from './_lib/providers.js';

export default async function handler(req, res) {
  const probe = req.query?.probe === '1';
  const status = providerStatus();

  if (!probe) {
    res.status(200).json({ ok: true, configured: status, hint: 'add ?probe=1 to test live' });
    return;
  }

  const result = await callAI(
    'You are a one-word echo. Reply with exactly the single word: pong',
    'ping',
  );
  res.status(200).json({
    ok: !!result.text,
    configured: status,
    providerUsed: result.providerUsed,
    sample: result.text?.slice(0, 100),
  });
}
