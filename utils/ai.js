import { getApiKey } from './storage.js';
import { getDomain } from './helpers.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL   = 'claude-haiku-4-5-20251001';

function headers(key) {
  return {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
    'anthropic-dangerous-direct-browser-access': 'true'
  };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

export async function suggestSessionName(tabs) {
  const key = await getApiKey();
  if (!key) return null;

  const list = tabs.slice(0, 20)
    .map(t => `${t.title} (${getDomain(t.url)})`)
    .join('\n');

  try {
    const res = await withTimeout(fetch(API_URL, {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 20,
        messages: [{
          role: 'user',
          content: `Name this browser session in 2-4 words. Reply with ONLY the name, no punctuation or quotes:\n\n${list}`
        }]
      })
    }), 6000);

    if (!res.ok) return null;
    const data = await res.json();
    return data.content?.[0]?.text?.trim().replace(/^["'`]+|["'`]+$/g, '') || null;
  } catch {
    return null;
  }
}

export async function suggestTabGroups(tabs) {
  const key = await getApiKey();
  if (!key) return null;

  const list = tabs
    .map((t, i) => `${i}: ${t.title} | ${getDomain(t.url)}`)
    .join('\n');

  try {
    const res = await withTimeout(fetch(API_URL, {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `Group these browser tabs by topic or purpose into 2-5 meaningful groups. Reply with ONLY valid JSON, no markdown fences:\n{"groups":[{"name":"2-4 word label","indices":[0,1,2]}]}\n\nTabs:\n${list}`
        }]
      })
    }), 10000);

    if (!res.ok) return null;
    const data = await res.json();
    const text = data.content?.[0]?.text?.trim() || '';
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}
