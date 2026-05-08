/**
 * Netlify Function: metaculus-proxy
 * Proxies Metaculus API — tries multiple endpoints for resilience
 */

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const qs = event.queryStringParameters || {};

  // Try endpoints in order
  const attempts = [
    // Old API (still works for public questions)
    `https://www.metaculus.com/api2/questions/?${new URLSearchParams({ format: 'json', ...qs })}`,
    // Alternative with www removed
    `https://metaculus.com/api2/questions/?${new URLSearchParams({ format: 'json', ...qs })}`,
  ];

  for (const url of attempts) {
    try {
      const r = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; MarketOracle/1.0)',
          'Referer': 'https://www.metaculus.com/',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!r.ok) continue;
      const data = await r.json();
      if (data?.results?.length > 0) {
        return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };
      }
    } catch (e) {
      console.error('Metaculus attempt failed:', url, e.message);
    }
  }

  // Return empty but valid response — app handles gracefully
  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ results: [], count: 0, _source: 'fallback' }),
  };
};
