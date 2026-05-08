/**
 * Netlify Function: polymarket-proxy
 * Proxies Polymarket Gamma API to avoid CORS issues
 *
 * GET /.netlify/functions/polymarket-proxy?limit=20&active=true&closed=false
 * GET /.netlify/functions/polymarket-proxy?limit=50&order=startDate&ascending=false
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
    const url = `https://gamma-api.polymarket.com/markets?${params}`;

    const r = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'MarketOracle/1.0' }
    });

    if (!r.ok) throw new Error(`Polymarket ${r.status}`);
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
