// Overwatch — NSE delivery-percentage data source (P4.2). STUB.
//
// The institutional-footprint check (see momentum-campaign.md) needs NSE
// security-wise delivery data (delivery % of traded qty). Groww MCP does NOT
// expose it. Until an approved source is wired, this returns UNAVAILABLE — callers
// must render the check as "PENDING data source" and NEVER fabricate a value
// (Standing Order 8: no fiction).
//
// TODO(P4.2): the option is the NSE daily archive CSV (security-wise delivery
// position / bhavcopy, https://www.nseindia.com archives). Do NOT scrape it without
// explicit operator approval. When approved: fetch the daily CSV, parse delivery
// qty ÷ traded qty per symbol, and expose getDeliveryPct(symbol, date) plus a
// 20-day average helper for the momentum-campaign confirmation.

function getDeliveryPct(/* symbol, date */) {
  return { status: 'UNAVAILABLE', reason: 'no data source configured' };
}

function getDelivery20dAvg(/* symbol */) {
  return { status: 'UNAVAILABLE', reason: 'no data source configured' };
}

module.exports = { getDeliveryPct, getDelivery20dAvg };
