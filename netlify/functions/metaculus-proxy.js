/**
 * Netlify Function: metaculus-proxy
 * Proxies Metaculus API to avoid CORS issues
 *
 * GET /.netlify/functions/metaculus-proxy?limit=15&status=open
 * GET /.netlify/functions/metaculus-proxy?limit=10&search=riksbank
 */

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  try {
    const qs = event.queryStringParameters || {};
    const params = new URLSearchParams({ format: 'json', ...qs }).toString();
    const url = `https://www.metaculus.com/api2/questions/?${params}`;

    const r = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'MarketOracle/1.0' }
    });

    if (!r.ok) throw new Error(`Metaculus ${r.status}`);
    const data = await r.json();

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify(data),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
