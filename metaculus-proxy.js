/**
 * Netlify Function: metaculus-proxy
 * Tries multiple Metaculus endpoints with browser-like headers to bypass IP blocking
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

  // Browser-like headers — critical for avoiding cloud IP blocks
  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,sv;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': 'https://www.metaculus.com/questions/',
    'Origin': 'https://www.metaculus.com',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  };

  const params = new URLSearchParams({
    limit:    qs.limit    || '15',
    status:   qs.status   || 'open',
    order_by: qs.order_by || '-activity',
    ...(qs.search ? { search: qs.search } : {}),
  });

  const urls = [
    `https://www.metaculus.com/api2/questions/?${params}`,
    `https://metaculus.com/api2/questions/?${params}`,
  ];

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 10000);
      const r = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(tid);

      if (!r.ok) { console.log(`Metaculus HTTP ${r.status}`); continue; }

      const data = await r.json();
      if (data?.results?.length > 0) {
        return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };
      }
    } catch (e) {
      console.error('Metaculus attempt:', e.message);
    }
  }

  // Return empty — app handles this gracefully
  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ results: [], count: 0, _fallback: true }),
  };
};
