/**
 * Netlify Function: avanza-proxy  (avanza@3.x)
 *
 * Endpoints:
 *   GET  ?action=test
 *   GET  ?action=search&q=Ericsson
 *   GET  ?action=quote&type=STOCK&id=123
 *   GET  ?action=chart&id=123&period=month
 *   GET  ?action=portfolio
 *   GET  ?action=overview
 *   POST ?action=order   body: { accountId, orderbookId, orderType, price, volume }
 *
 * Netlify env vars: AVANZA_USERNAME, AVANZA_PASSWORD, AVANZA_TOTP_SECRET
 */

const Avanza = require('avanza');

let _client  = null;
let _lastAuth = 0;
const AUTH_TTL = 8 * 60 * 1000;

async function getClient() {
  if (_client && Date.now() - _lastAuth < AUTH_TTL) return _client;
  const { AVANZA_USERNAME: username, AVANZA_PASSWORD: password, AVANZA_TOTP_SECRET: totpSecret } = process.env;
  if (!username || !password) throw new Error('AVANZA_USERNAME / AVANZA_PASSWORD saknas i Netlify-miljövariablerna.');
  const avanza = Avanza.default ? new Avanza.default() : new Avanza();
  await avanza.authenticate({ username, password, totpSecret });
  _client = avanza; _lastAuth = Date.now();
  return _client;
}

const CORS = { 'Access-Control-Allow-Origin':'*', 'Content-Type':'application/json', 'Access-Control-Allow-Headers':'Content-Type', 'Access-Control-Allow-Methods':'GET,POST,OPTIONS' };
const resp = (code, body) => ({ statusCode: code, headers: CORS, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const p = event.queryStringParameters || {};
  const action = p.action || 'test';

  try {
    const av = await getClient();

    if (action === 'test') {
      const ov = await av.getOverview();
      return resp(200, { ok: true, accounts: ov?.accounts?.length || 0 });
    }

    if (action === 'search') {
      if (!p.q) return resp(400, { error: 'q krävs' });
      const raw = await av.search(p.q);
      const hits = raw?.hits || raw || [];
      const instruments = hits.flatMap(g =>
        (g.topHits || g.instruments || []).map(i => ({
          id: i.id, name: i.name,
          ticker: i.ticker || i.shortName || i.name,
          type: i.instrumentType || g.instrumentType || 'STOCK',
          currency: i.currency, flagCode: i.flagCode,
        }))
      ).filter(i => i.id);
      return resp(200, { instruments });
    }

    if (action === 'quote') {
      if (!p.id) return resp(400, { error: 'id krävs' });
      const d = await av.getInstrument((p.type || 'STOCK').toUpperCase(), p.id);
      const q = d?.quote || {};
      return resp(200, {
        id: p.id, name: d?.name, ticker: d?.shortName,
        lastPrice: q.last, change: q.change, changePercent: q.changePercent,
        bid: q.bid, ask: q.ask, high: q.highest, low: q.lowest, volume: q.totalVolume,
        currency: d?.currency, pe: d?.keyRatios?.pe,
        directYield: d?.keyRatios?.directYield, updated: new Date().toISOString(),
      });
    }

    if (action === 'chart') {
      if (!p.id) return resp(400, { error: 'id krävs' });
      const d = await av.getChartdata(p.id, p.period || 'month');
      return resp(200, { id: p.id, period: p.period, points: (d?.dataPoints || []).map(pt => ({ date: pt.timestamp, close: pt.value ?? pt.close })) });
    }

    if (action === 'portfolio') {
      const pos = await av.getPositions();
      const holdings = (pos?.instrumentPositions || []).flatMap(cat =>
        (cat.positions || []).map(p => ({
          id: p.orderbookId, name: p.name, ticker: p.shortName || p.name,
          type: cat.instrumentType, qty: p.volume, gav: p.averageAcquiredPrice,
          lastPrice: p.lastPrice, value: p.value,
          changePercent: p.changePercent, pnl: p.profit, pnlPercent: p.profitPercent,
          currency: p.currency, accountName: p.accountName,
        }))
      );
      return resp(200, { holdings, totalValue: (pos?.instrumentPositions || []).reduce((s, c) => s + (c.totalValue || 0), 0) });
    }

    if (action === 'overview') {
      return resp(200, await av.getOverview());
    }

    if (action === 'order') {
      if (event.httpMethod !== 'POST') return resp(405, { error: 'POST krävs' });
      const b = JSON.parse(event.body || '{}');
      const r = await av.placeOrder({ accountId: b.accountId, orderbookId: b.orderbookId, orderType: b.orderType, price: b.price, validUntil: b.validUntil || new Date(Date.now()+86400000).toISOString().slice(0,10), volume: b.volume });
      return resp(200, { ok: true, orderId: r?.orderId });
    }

    return resp(400, { error: `Okänd action: ${action}` });

  } catch (e) {
    console.error('[avanza-proxy]', e.message);
    if (/auth|401|403|session/i.test(e.message)) _client = null;
    return resp(500, { error: e.message });
  }
};
