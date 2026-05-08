/**
 * Netlify Function: avanza-proxy
 * Proxies requests to Avanza's internal API
 *
 * Endpoints:
 *   GET  /api/avanza?action=quote&id=5361           - Get quote by Avanza orderbookId
 *   GET  /api/avanza?action=search&q=Ericsson       - Search instruments
 *   GET  /api/avanza?action=portfolio               - Get your positions
 *   GET  /api/avanza?action=accounts                - Get account overview
 *   GET  /api/avanza?action=chart&id=5361&period=month - Chart data
 *   POST /api/avanza?action=order                   - Place order (body: JSON)
 *   GET  /api/avanza?action=test                    - Test authentication
 *
 * Credentials via Netlify environment variables:
 *   AVANZA_USERNAME  - Your Avanza username
 *   AVANZA_PASSWORD  - Your Avanza password
 *   AVANZA_TOTP_SECRET - TOTP secret (base32, from Avanza security settings)
 *
 * TOTP setup: In Avanza → Inställningar → Säkerhet → Tvåfaktorsautentisering
 * Choose "Authenticator-app", scan QR but also copy the text secret.
 */

import Avanza, { TwoFactorMethod } from 'avanza';

// Module-level session cache (reused across warm lambda invocations)
let avanzaClient = null;
let lastAuthTime  = 0;
const AUTH_TTL_MS = 10 * 60 * 1000; // re-auth every 10 minutes

async function getClient() {
  const now = Date.now();
  if (avanzaClient && (now - lastAuthTime) < AUTH_TTL_MS) {
    return avanzaClient;
  }

  const username   = process.env.AVANZA_USERNAME;
  const password   = process.env.AVANZA_PASSWORD;
  const totpSecret = process.env.AVANZA_TOTP_SECRET;

  if (!username || !password) {
    throw new Error('AVANZA_USERNAME och AVANZA_PASSWORD måste sättas som miljövariabler i Netlify.');
  }

  const client = new Avanza();
  await client.authenticate({
    username,
    password,
    totpSecret: totpSecret || undefined,
    twoFactorMethod: totpSecret ? TwoFactorMethod.TOTP : TwoFactorMethod.NONE,
  });

  avanzaClient = client;
  lastAuthTime  = now;
  return client;
}

// CORS headers for all responses
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

export const handler = async (event) => {
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const params = event.queryStringParameters || {};
  const action = params.action || 'test';

  try {
    const client = await getClient();

    // ── TEST ──────────────────────────────────────────────
    if (action === 'test') {
      const overview = await client.getAccountsOverview();
      return {
        statusCode: 200, headers: CORS,
        body: JSON.stringify({ ok: true, message: 'Autentisering lyckades', accounts: overview?.accounts?.length || 0 })
      };
    }

    // ── SEARCH ────────────────────────────────────────────
    if (action === 'search') {
      const query = params.q || '';
      if (!query) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'q parameter krävs' }) };
      const results = await client.searchForInstruments(query, 10);
      // Normalize results
      const instruments = (results?.instrumentList || results || []).map(inst => ({
        id:     inst.id       || inst.orderbookId,
        name:   inst.name     || inst.shortName,
        ticker: inst.ticker   || inst.shortName,
        type:   inst.instrumentType || inst.type,
        isin:   inst.isin,
        currency: inst.currency,
        market: inst.marketList || inst.tradingCurrency,
        flagCode: inst.flagCode,
      }));
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ instruments }) };
    }

    // ── QUOTE ─────────────────────────────────────────────
    if (action === 'quote') {
      const id = params.id;
      if (!id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'id parameter krävs' }) };
      const stock = await client.getStockSettings(id);
      const orderbook = await client.getOrderbook(id, 'STOCK').catch(() => null);
      return {
        statusCode: 200, headers: CORS,
        body: JSON.stringify({
          id,
          name:           stock?.stock?.name,
          ticker:         stock?.stock?.shortName,
          lastPrice:      stock?.stock?.quote?.last,
          change:         stock?.stock?.quote?.change,
          changePercent:  stock?.stock?.quote?.changePercent,
          bid:            stock?.stock?.quote?.bid,
          ask:            stock?.stock?.quote?.ask,
          high:           stock?.stock?.quote?.highest,
          low:            stock?.stock?.quote?.lowest,
          volume:         stock?.stock?.quote?.totalVolume,
          currency:       stock?.stock?.currency,
          marketCap:      stock?.stock?.company?.marketCapital,
          pe:             stock?.stock?.keyRatios?.pe,
          ps:             stock?.stock?.keyRatios?.ps,
          directYield:    stock?.stock?.keyRatios?.directYield,
          updated:        new Date().toISOString(),
        })
      };
    }

    // ── CHART ─────────────────────────────────────────────
    if (action === 'chart') {
      const id     = params.id;
      const period = params.period || 'month'; // week, month, year, threeYears
      if (!id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'id parameter krävs' }) };
      const chart = await client.getChartdata(id, period);
      const points = (chart?.dataPoints || []).map(p => ({
        date:  p.timestamp,
        close: p.value || p.close,
      }));
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ id, period, points }) };
    }

    // ── PORTFOLIO ─────────────────────────────────────────
    if (action === 'portfolio') {
      const positions = await client.getPositions();
      const accounts  = await client.getAccountsOverview();

      const holdings = (positions?.instrumentPositions || []).flatMap(cat =>
        (cat.positions || []).map(p => ({
          id:            p.orderbookId || p.id,
          name:          p.name,
          ticker:        p.shortName || p.name,
          type:          cat.instrumentType,
          qty:           p.volume,
          gav:           p.averageAcquiredPrice,
          lastPrice:     p.lastPrice,
          value:         p.value,
          change:        p.change,
          changePercent: p.changePercent,
          pnl:           p.profit,
          pnlPercent:    p.profitPercent,
          currency:      p.currency,
          flagCode:      p.flagCode,
        }))
      );

      const totalValue = accounts?.totalBalance || 0;

      return {
        statusCode: 200, headers: CORS,
        body: JSON.stringify({ holdings, totalValue, accounts: accounts?.accounts })
      };
    }

    // ── ACCOUNTS ──────────────────────────────────────────
    if (action === 'accounts') {
      const overview = await client.getAccountsOverview();
      return { statusCode: 200, headers: CORS, body: JSON.stringify(overview) };
    }

    // ── PLACE ORDER ───────────────────────────────────────
    if (action === 'order') {
      if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'POST krävs för order' }) };
      }
      const body = JSON.parse(event.body || '{}');
      // Required: accountId, orderbookId, orderType (BUY/SELL), price, validUntil, volume
      const result = await client.placeOrder({
        accountId:    body.accountId,
        orderbookId:  body.orderbookId,
        orderType:    body.orderType, // 'BUY' | 'SELL'
        price:        body.price,
        validUntil:   body.validUntil || new Date(Date.now() + 86400000).toISOString().slice(0,10),
        volume:       body.volume,
      });
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, orderId: result?.orderId, result }) };
    }

    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `Okänd action: ${action}` }) };

  } catch (err) {
    console.error('Avanza proxy error:', err);
    // Reset client on auth error so next request re-authenticates
    if (err.message?.includes('auth') || err.message?.includes('401') || err.message?.includes('403')) {
      avanzaClient = null;
    }
    return {
      statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: err.message || 'Okänt fel', hint: 'Kontrollera AVANZA_USERNAME, AVANZA_PASSWORD och AVANZA_TOTP_SECRET i Netlify-inställningarna.' })
    };
  }
};
