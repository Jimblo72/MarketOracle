/**
 * Netlify Function: manifold-proxy
 * Proxies Manifold Markets API to avoid CORS issues
 *
 * GET /.netlify/functions/manifold-proxy?term=riksbank&limit=10&filter=open
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
    const params = new URLSearchParams(qs).toString();
    const url = `https://api.manifold.markets/v0/search-markets?${params}`;

    const r = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'MarketOracle/1.0' }
    });

    if (!r.ok) throw new Error(`Manifold ${r.status}`);
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
