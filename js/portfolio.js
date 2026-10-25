// Money Tracker — Portfolio: allocation & targets, returns vs a benchmark, dividends, trading journal.
// Opened from the investments section on the Accounts page. Everything here is a view of your own data;
// it shows what is happening, it does not recommend what to buy or sell.
// Loaded as a plain <script>: functions are global so onclick="..." handlers work.

var portfolioMeta = { targets: {}, benchmarkSymbol: 'INDEXBKK:SET', benchmark: null, tradeCount: 0 };
var pfTab = 'allocation';
var trades = null;                 // loaded when the Trading tab opens
var pfPeriod = 'all';

function setPortfolioMeta(p) { portfolioMeta = Object.assign({ targets: {} }, p); }
function investHoldings() { return holdings.filter(function(h){ return h.group === 'investment'; }); }
function pct(n, d) { return d ? n / d * 100 : 0; }
function fmtPct(v, dp) { return (v >= 0 ? '' : '−') + Math.abs(v).toFixed(dp === undefined ? 1 : dp) + '%'; }
function signMoney(v) { return (v > 0.005 ? '+' : v < -0.005 ? '−' : '') + fmtMoney(Math.abs(v)); }
function plClass(v) { return v > 0.005 ? 'pl-pos' : v < -0.005 ? 'pl-neg' : 'pl-zero'; }

function openPortfolio(tab) {
  if (tab) pfTab = tab;
  document.getElementById('portfolio-modal').classList.add('open');
  renderPortfolio();
}
function closePortfolio() { document.getElementById('portfolio-modal').classList.remove('open'); }
function setPfTab(t) { pfTab = t; renderPortfolio(); }
function renderPortfolio() {
  var ov = document.getElementById('portfolio-modal');
  if (!ov || !ov.classList.contains('open')) return;
  ['allocation','returns','dividends','trading'].forEach(function(t){ document.getElementById('pf-tab-' + t).classList.toggle('active', t === pfTab); });
  var el = document.getElementById('pf-body');
  if (pfTab === 'allocation') el.innerHTML = allocationHtml();
  else if (pfTab === 'returns') el.innerHTML = returnsHtml();
  else if (pfTab === 'dividends') el.innerHTML = dividendsHtml();
  else { if (!trades) { el.innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>'; loadTrades(); } else el.innerHTML = tradingHtml(); }
}

// ════════════════════════════════════════════
//  1) ALLOCATION & TARGETS
// ════════════════════════════════════════════
var ALLOC_ORDER = ['Gold','Thai stocks','Thai ETFs','Foreign stocks','Global ETFs','Mutual funds','Bonds','Crypto','Other','Cash'];
function isThaiSymbol(h) { return /\.BK$|^BKK:|^SET:/i.test(h.symbol || '') || (h.quoteCurrency || '').toUpperCase() === 'THB'; }
function holdingClass(h) {
  switch (h.kind) {
    case 'gold':   return 'Gold';
    case 'stock':  return (!h.symbol || isThaiSymbol(h)) ? 'Thai stocks' : 'Foreign stocks';
    case 'etf':    return isThaiSymbol(h) ? 'Thai ETFs' : 'Global ETFs';
    case 'fund':   return 'Mutual funds';
    case 'bond':   return 'Bonds';
    case 'crypto': return 'Crypto';
  }
  return 'Other';
}
function holdingCurrency(h) {
  if (h.kind === 'gold') return 'Gold';
  if (h.quoteCurrency) return h.quoteCurrency.toUpperCase();
  return isThaiSymbol(h) || !h.symbol ? 'THB' : 'Foreign';
}
function allocIncludeCash() { try { return localStorage.getItem('pfCash') === '1'; } catch(e) { return false; } }
function toggleAllocCash() { try { localStorage.setItem('pfCash', allocIncludeCash() ? '0' : '1'); } catch(e) {} renderPortfolio(); }
function allocation() {
  var byClass = {}, byCur = {}, total = 0;
  investHoldings().forEach(function(h) {
    if (h.value <= 0) return;
    var c = holdingClass(h), k = holdingCurrency(h);
    byClass[c] = (byClass[c] || 0) + h.value; byCur[k] = (byCur[k] || 0) + h.value; total += h.value;
  });
  if (allocIncludeCash()) accounts.forEach(function(a) {
    if (['bank','cash','wallet','investment'].indexOf(a.type) < 0) return;
    var v = acctThb(a); if (v <= 0) return;
    byClass.Cash = (byClass.Cash || 0) + v; byCur[a.currency || 'THB'] = (byCur[a.currency || 'THB'] || 0) + v; total += v;
  });
  return { byClass: byClass, byCur: byCur, total: total };
}
function allocDrifts() {
  var a = allocation(), t = portfolioMeta.targets || {}, out = [];
  if (!a.total) return out;
  Object.keys(t).forEach(function(c) {
    var actual = pct(a.byClass[c] || 0, a.total);
    out.push({ cls: c, actual: actual, target: t[c], drift: actual - t[c] });
  });
  return out;
}
function allocRow(name, value, total, target) {
  var p = pct(value, total), drift = target !== undefined ? p - target : null;
  var big = drift !== null && Math.abs(drift) >= 5;
  return '<div class="al-row"><div class="al-top"><span class="al-name">' + recEsc(name) + '</span>' +
    '<span class="al-val">' + fmtMoney(value) + ' · <b>' + p.toFixed(1) + '%</b></span></div>' +
    '<div class="al-bar"><div class="al-fill" style="width:' + Math.min(100, p) + '%"></div>' +
    (target !== undefined ? '<div class="al-target" style="left:' + Math.min(100, target) + '%" title="Target ' + target + '%"></div>' : '') + '</div>' +
    (target !== undefined ? '<div class="al-drift' + (big ? ' big' : '') + '">Target ' + target + '% · ' + (Math.abs(drift) < 0.05 ? 'on target' : (drift > 0 ? '+' : '−') + Math.abs(drift).toFixed(1) + ' pts ' + (drift > 0 ? 'over' : 'under')) + '</div>' : '') +
  '</div>';
}
function allocationHtml() {
  var a = allocation(), t = portfolioMeta.targets || {};
  if (!a.total) return '<div class="empty"><div class="empty-icon">🥧</div><p>Add investments (Accounts → + Add asset / investment) to see your allocation.</p></div>';
  var classes = Object.keys(a.byClass).concat(Object.keys(t).filter(function(c){ return !a.byClass[c]; }))
    .sort(function(x, y){ var i = ALLOC_ORDER.indexOf(x), j = ALLOC_ORDER.indexOf(y); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j); });
  var html = '<div class="pf-hero"><div class="pf-hero-l">' + (allocIncludeCash() ? 'Investments + cash' : 'Investments') + '</div><div class="pf-hero-v">' + fmtMoney(a.total) + '</div>' +
    '<button class="pf-link" onclick="toggleAllocCash()">' + (allocIncludeCash() ? 'Hide cash' : 'Include cash & bank accounts') + '</button></div>';
  html += '<div class="card"><div class="card-title">By asset type <button class="pf-link" onclick="editTargets()">' + (Object.keys(t).length ? 'Edit targets' : 'Set targets') + '</button></div>' +
    classes.map(function(c){ return allocRow(c, a.byClass[c] || 0, a.total, t[c]); }).join('') +
    (Object.keys(t).length ? '<div class="pf-note">The line on each bar is your target. A difference of 5 points or more is highlighted, and shows on the dashboard as a heads-up.</div>' : '') +
    '<div id="target-editor"></div></div>';
  html += '<div class="card"><div class="card-title">By currency</div>' +
    Object.keys(a.byCur).sort(function(x, y){ return a.byCur[y] - a.byCur[x]; }).map(function(c){ return allocRow(c === 'Gold' ? 'Gold (priced in USD worldwide)' : c, a.byCur[c], a.total); }).join('') +
    '<div class="pf-note">Based on the currency each price is quoted in. Thai stocks without a symbol count as THB.</div></div>';
  return html;
}
function editTargets() {
  var a = allocation(), t = portfolioMeta.targets || {};
  var classes = ALLOC_ORDER.filter(function(c){ return a.byClass[c] || t[c] || (c === 'Cash' && allocIncludeCash()); });
  ALLOC_ORDER.forEach(function(c){ if (classes.indexOf(c) < 0 && ['Gold','Thai stocks','Global ETFs'].indexOf(c) >= 0) classes.push(c); });
  document.getElementById('target-editor').innerHTML = '<div class="tg-box"><div class="stmt-head">Target % of ' + (allocIncludeCash() ? 'investments + cash' : 'investments') + '</div>' +
    classes.map(function(c){ return '<div class="tg-row"><span>' + c + '</span><input type="number" class="form-control tg-in" data-cls="' + escAttr(c) + '" value="' + (t[c] || '') + '" min="0" max="100" step="1" inputmode="numeric" oninput="targetSum()">%</div>'; }).join('') +
    '<div class="tg-sum" id="tg-sum"></div><div class="btn-row"><button class="btn btn-primary btn-sm" onclick="saveTargets()">Save targets</button><button class="btn btn-ghost btn-sm" onclick="renderPortfolio()">Cancel</button></div></div>';
  targetSum();
}
function targetSum() {
  var s = 0; document.querySelectorAll('.tg-in').forEach(function(i){ s += parseFloat(i.value) || 0; });
  var el = document.getElementById('tg-sum');
  el.textContent = 'Total ' + s + '%' + (s === 100 ? ' ✓' : ' — should add up to 100%');
  el.className = 'tg-sum ' + (s === 100 ? 'pl-pos' : 'pl-neg');
}
function saveTargets() {
  var t = {}; document.querySelectorAll('.tg-in').forEach(function(i){ var v = parseFloat(i.value) || 0; if (v > 0) t[i.getAttribute('data-cls')] = v; });
  api({ action: 'setTargets', targets: t }).then(function(res) {
    if (!res.ok) { toast(/Unknown action/.test(res.error || '') ? 'Update Code.gs in Apps Script and redeploy first' : 'Error: ' + (res.error || '?')); return; }
    portfolioMeta.targets = t; toast('Targets saved'); renderPortfolio(); renderSmart();
  }).catch(function(){ toast('Saving targets needs a connection'); });
}

// ════════════════════════════════════════════
//  2) RETURNS — money-weighted (XIRR): counts when you put money in or took it out
// ════════════════════════════════════════════
function yearFrac(a, b) { return (new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / (365.25 * 86400000); }
function xirr(flows) {                      // flows: [[date, amount]] (− = money in, + = money out/value)
  if (flows.length < 2) return null;
  flows = flows.slice().sort(function(a, b){ return a[0].localeCompare(b[0]); });
  var d0 = flows[0][0], span = yearFrac(d0, flows[flows.length - 1][0]);
  if (span < 30 / 365) return null;
  var hasNeg = flows.some(function(f){ return f[1] < 0; }), hasPos = flows.some(function(f){ return f[1] > 0; });
  if (!hasNeg || !hasPos) return null;
  var npv = function(r){ return flows.reduce(function(s, f){ return s + f[1] / Math.pow(1 + r, yearFrac(d0, f[0])); }, 0); };
  var lo = -0.9999, hi = 10, flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (var i = 0; i < 200; i++) {
    var mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}
function holdingFlows(h, withValue) {
  var f = [];
  h.txns.forEach(function(t) {
    if (t.type === 'buy') f.push([t.date, -(t.amount + (t.fee || 0))]);
    else if (t.type === 'sell') f.push([t.date, t.amount - (t.fee || 0)]);
    else if (t.type === 'dividend') f.push([t.date, t.amount]);
  });
  if (withValue && h.quantity > 0) f.push([todayStr(), h.value]);
  return f;
}
function holdingPerf(h) {
  var put = 0, back = 0;
  h.txns.forEach(function(t) {
    if (t.type === 'buy') put += t.amount + (t.fee || 0);
    else if (t.type === 'sell') back += t.amount - (t.fee || 0);
    else if (t.type === 'dividend') back += t.amount;
  });
  var gain = back + h.value - put;
  return { put: put, gain: gain, pct: pct(gain, put), irr: xirr(holdingFlows(h, true)) };
}
// "What if the same money had gone into the benchmark?" — same dates and amounts in and out
function benchPriceAt(series, date) {
  var p = series[0][1];
  for (var i = 0; i < series.length && series[i][0] <= date; i++) p = series[i][1];
  return p;
}
function benchmarkCompare(flows) {
  var b = portfolioMeta.benchmark;
  if (!b || !b.series || b.series.length < 2) return null;
  var units = 0, bf = [];
  flows.forEach(function(f) {
    var px = benchPriceAt(b.series, f[0]);
    units += -f[1] / px;                       // money in buys units, money out sells units
    bf.push(f);
  });
  var last = b.series[b.series.length - 1];
  var value = units * last[1];
  bf.push([todayStr(), value]);
  return { value: value, irr: xirr(bf), asOf: last[0], symbol: b.symbol };
}
var BENCH_PRESETS = [['INDEXBKK:SET', 'SET index'], ['INDEXSP:.INX', 'S&P 500'], ['NYSEARCA:ACWI', 'World (ACWI)'], ['NYSEARCA:GLD', 'Gold ETF (GLD)']];
function benchName(sym) { var p = BENCH_PRESETS.find(function(x){ return x[0] === sym; }); return p ? p[1] : sym; }
function returnsHtml() {
  var hs = investHoldings().filter(function(h){ return h.txns.length; });
  if (!hs.length) return '<div class="empty"><div class="empty-icon">📈</div><p>No investments yet.</p></div>';
  var all = [], put = 0, gain = 0, divs = 0, fees = 0, realized = 0, unreal = 0;
  var rows = hs.map(function(h) {
    var p = holdingPerf(h);
    all = all.concat(holdingFlows(h, false));
    put += p.put; gain += p.gain; divs += h.dividends; fees += h.fees; realized += h.realized; unreal += h.unrealized;
    return { h: h, p: p };
  }).sort(function(a, b){ return b.h.value - a.h.value; });
  var value = hs.reduce(function(s, h){ return s + h.value; }, 0);
  var totFlows = all.concat(value > 0 ? [[todayStr(), value]] : []);
  var irr = xirr(totFlows), bench = benchmarkCompare(all.slice().sort(function(a, b){ return a[0].localeCompare(b[0]); }));
  var html = '<div class="pf-hero"><div class="pf-hero-l">Total gain on your investments</div>' +
    '<div class="pf-hero-v ' + plClass(gain) + '">' + signMoney(gain) + ' <small>(' + fmtPct(pct(gain, put)) + ')</small></div>' +
    '<div class="pf-hero-s">' + (irr !== null ? '<b>' + fmtPct(irr * 100) + ' a year</b> (money-weighted) · ' : '') + 'invested ' + fmtMoney(put) + '</div></div>';
  html += '<div class="hd-grid" style="margin-bottom:12px">' +
    [['Price gain (not sold)', signMoney(unreal), plClass(unreal)], ['Price gain (sold)', signMoney(realized), plClass(realized)],
     ['Dividends', '+' + fmtMoney(divs), 'pl-pos'], ['Fees', '−' + fmtMoney(fees), 'pl-zero']].map(function(x) {
      return '<div class="hd-stat"><div class="l">' + x[0] + '</div><div class="v ' + x[2] + '">' + x[1] + '</div></div>';
    }).join('') + '</div>';
  // benchmark
  html += '<div class="card"><div class="card-title">Compared with ' + recEsc(benchName(portfolioMeta.benchmarkSymbol)) + '</div>';
  if (bench && bench.irr !== null && irr !== null) {
    var diff = (irr - bench.irr) * 100;
    html += '<div class="bm-row"><span>Your investments</span><b>' + fmtPct(irr * 100) + ' / yr</b></div>' +
      '<div class="bm-row"><span>Same money in ' + recEsc(benchName(bench.symbol)) + '</span><b>' + fmtPct(bench.irr * 100) + ' / yr</b></div>' +
      '<div class="bm-row"><span>Difference</span><b class="' + plClass(diff) + '">' + (diff >= 0 ? '+' : '−') + Math.abs(diff).toFixed(1) + ' pts</b></div>' +
      '<div class="pf-note">"Same money" puts each of your buys into the index on the same day and takes sales out on the same day. Index prices exclude dividends, so it\'s slightly harsh on the index. Prices to ' + fmtDate(bench.asOf) + '.</div>';
  } else {
    html += '<div class="pf-note">' + (portfolioMeta.benchmark ? 'Not enough history yet to compare (needs at least a month).' : 'Index prices haven\'t been fetched yet — tap ↻ Refresh on the Accounts page (or wait for the 7am update).') + '</div>';
  }
  html += '<div class="bm-presets">' + BENCH_PRESETS.map(function(p) {
      return '<button class="filter-chip' + (p[0] === portfolioMeta.benchmarkSymbol ? ' active' : '') + '" onclick="setBenchmarkSym(\'' + p[0] + '\')">' + p[1] + '</button>';
    }).join('') + '<button class="filter-chip" onclick="setBenchmarkSym()">Other…</button></div></div>';
  // per holding
  html += '<div class="card"><div class="card-title">By holding</div>' + rows.map(function(r) {
    return '<div class="pr-row" onclick="closePortfolio();openHolding(\'' + escQ(r.h.id) + '\')"><div class="pr-l"><div class="pr-n">' + kindInfo(r.h.kind)[1] + ' ' + recEsc(r.h.name) + '</div>' +
      '<div class="pr-s">invested ' + fmtMoney(r.p.put) + ' · now ' + fmtMoney(r.h.value) + (r.h.dividends ? ' · div ' + fmtMoney(r.h.dividends) : '') + '</div></div>' +
      '<div class="pr-r"><div class="' + plClass(r.p.gain) + '">' + signMoney(r.p.gain) + '</div><div class="pr-s">' + (r.p.irr !== null ? fmtPct(r.p.irr * 100) + '/yr' : fmtPct(r.p.pct) + ' total') + '</div></div></div>';
  }).join('') + '<div class="pf-note">"/yr" is shown once a holding is older than a month. Gains include dividends received and fees paid.</div></div>';
  return html;
}
function setBenchmarkSym(sym) {
  if (!sym) { sym = prompt('Google Finance symbol to compare with (e.g. INDEXBKK:SET, NASDAQ:VXUS):', portfolioMeta.benchmarkSymbol || ''); if (!sym) return; }
  toast('Fetching ' + benchName(sym.toUpperCase()) + '…');
  api({ action: 'setBenchmark', symbol: sym }).then(function(res) {
    if (!res.ok) { toast(/Unknown action/.test(res.error || '') ? 'Update Code.gs in Apps Script and redeploy first' : 'Error: ' + (res.error || '?')); return; }
    if (res.benchmark && !res.benchmark.ok) toast('No prices found for ' + sym + ' — try another symbol', 4000);
    loadAll().then(renderPortfolio);
  }).catch(function(){ toast('Needs a connection'); });
}

// ════════════════════════════════════════════
//  3) DIVIDENDS
// ════════════════════════════════════════════
function dividendTxns() {
  var out = [];
  investHoldings().forEach(function(h){ h.txns.forEach(function(t){ if (t.type === 'dividend') out.push({ h: h, t: t }); }); });
  return out.sort(function(a, b){ return b.t.date.localeCompare(a.t.date); });
}
function dividendsHtml() {
  var dv = dividendTxns(), today = todayStr(), yAgo = addDaysStr(today, -365);
  var months = [], now = new Date();
  for (var k = 11; k >= 0; k--) { var d = new Date(now.getFullYear(), now.getMonth() - k, 1); months.push({ key: d.getFullYear() + '-' + pad(d.getMonth() + 1), m: d.getMonth(), v: 0 }); }
  var years = {}, ttm = 0, ttmTax = 0;
  dv.forEach(function(x) {
    var y = x.t.date.substring(0, 4), tax = x.t.fee || 0;
    years[y] = years[y] || { net: 0, tax: 0 }; years[y].net += x.t.amount; years[y].tax += tax;
    var mo = months.find(function(m){ return m.key === x.t.date.substring(0, 7); }); if (mo) mo.v += x.t.amount;
    if (x.t.date > yAgo) { ttm += x.t.amount; ttmTax += tax; }
  });
  var hs = investHoldings();
  var cost = hs.reduce(function(s, h){ return s + h.cost; }, 0), value = hs.reduce(function(s, h){ return s + h.value; }, 0);
  var html = '<div class="pf-hero"><div class="pf-hero-l">Dividends, last 12 months</div><div class="pf-hero-v pl-pos">' + fmtMoney(ttm) + '</div>' +
    '<div class="pf-hero-s">≈ ' + fmtMoney(ttm / 12) + ' a month' + (ttmTax ? ' · ' + fmtMoney(ttmTax) + ' tax withheld' : '') +
    (cost ? ' · yield on cost ' + pct(ttm, cost).toFixed(2) + '%' : '') + '</div></div>';
  // monthly bars
  var max = Math.max.apply(null, months.map(function(m){ return m.v; }).concat([1]));
  html += '<div class="card"><div class="card-title">By month</div><div class="dv-bars">' + months.map(function(m) {
    var h = Math.round(m.v / max * 70);
    return '<div class="dv-col" title="' + SHORT_MON[m.m] + ': ' + fmtMoney(m.v) + '"><div class="dv-bar' + (m.v ? '' : ' zero') + '" style="height:' + Math.max(m.v ? 3 : 1, h) + 'px"></div><div class="dv-lbl">' + SHORT_MON[m.m].charAt(0) + '</div></div>';
  }).join('') + '</div>' +
  (Object.keys(years).length ? '<div class="dv-years">' + Object.keys(years).sort().reverse().map(function(y) {
    var v = years[y];
    return '<div class="bm-row"><span>' + y + '</span><span>' + (v.tax ? '<span class="pr-s">gross ' + fmtMoney(v.net + v.tax) + ' · tax ' + fmtMoney(v.tax) + ' · </span>' : '') + '<b>' + fmtMoney(v.net) + '</b></span></div>';
  }).join('') + '</div>' : '<div class="pf-note">No dividends recorded yet. Add them from a holding → Dividend.</div>') + '</div>';
  // upcoming
  var up = hs.filter(function(h){ return h.nextXD && h.nextXD >= addDaysStr(today, -30) && h.quantity > 0; })
    .sort(function(a, b){ return a.nextXD.localeCompare(b.nextXD); });
  html += '<div class="card"><div class="card-title">Upcoming (you add these) <button class="pf-link" onclick="editXD()">+ Add XD date</button></div>' +
    (up.length ? up.map(function(h) {
      var gross = (h.nextDividend || 0) * h.quantity, past = h.nextXD < today;
      return '<div class="bm-row"><span>' + kindInfo(h.kind)[1] + ' ' + recEsc(h.name) + '<br><span class="pr-s">XD ' + fmtDateY(h.nextXD) + (past ? ' (passed — record the payment when it arrives)' : '') + '</span></span>' +
        '<span style="text-align:right"><b>' + (gross ? '~' + fmtMoney(gross) : '—') + '</b><br><span class="pr-s">' + (h.nextDividend ? fmtMoney(h.nextDividend) + ' × ' + fmtQty(h.quantity) : '') +
        ' <button class="pf-link" onclick="editXD(\'' + escQ(h.id) + '\')">edit</button></span></span></div>';
    }).join('') : '<div class="pf-note">Add the next ex-dividend date and expected amount per share for a holding to see what\'s coming.</div>') +
    '<div id="xd-editor"></div></div>';
  // per holding
  var rows = hs.filter(function(h){ return h.dividends > 0 || h.quantity > 0; }).map(function(h) {
    var t12 = h.txns.filter(function(t){ return t.type === 'dividend' && t.date > yAgo; }).reduce(function(s, t){ return s + t.amount; }, 0);
    return { h: h, t12: t12 };
  }).filter(function(r){ return r.t12 > 0 || r.h.dividends > 0; }).sort(function(a, b){ return b.t12 - a.t12; });
  if (rows.length) html += '<div class="card"><div class="card-title">By holding (last 12 months)</div>' + rows.map(function(r) {
    return '<div class="pr-row"><div class="pr-l"><div class="pr-n">' + recEsc(r.h.name) + '</div><div class="pr-s">all-time ' + fmtMoney(r.h.dividends) + (r.h.taxWithheld ? ' · tax ' + fmtMoney(r.h.taxWithheld) : '') + '</div></div>' +
      '<div class="pr-r"><b>' + fmtMoney(r.t12) + '</b><div class="pr-s">' + (r.h.cost ? 'on cost ' + pct(r.t12, r.h.cost).toFixed(2) + '%' : '') + (r.h.value ? ' · now ' + pct(r.t12, r.h.value).toFixed(2) + '%' : '') + '</div></div></div>';
  }).join('') + '<div class="pf-note">"On cost" = dividends ÷ what you paid; "now" = ÷ today\'s value.</div></div>';
  return html;
}
function editXD(id) {
  var hs = investHoldings().filter(function(h){ return h.quantity > 0; });
  if (!hs.length) { toast('No investments held'); return; }
  var h = id ? holdingById(id) : hs[0];
  document.getElementById('xd-editor').innerHTML = '<div class="tg-box">' +
    '<div class="form-group"><label class="form-label">Holding</label><select class="form-control" id="xd-h">' + hs.map(function(x){ return '<option value="' + escAttr(x.id) + '"' + (x.id === h.id ? ' selected' : '') + '>' + recEsc(x.name) + '</option>'; }).join('') + '</select></div>' +
    '<div style="display:flex;gap:10px"><div class="form-group" style="flex:1"><label class="form-label">Ex-dividend date</label><input type="date" class="form-control" id="xd-date" value="' + (h.nextXD || '') + '"></div>' +
    '<div class="form-group" style="flex:1"><label class="form-label">Per share (฿, before tax)</label><input type="number" class="form-control" id="xd-amt" step="any" inputmode="decimal" value="' + (h.nextDividend || '') + '"></div></div>' +
    '<div class="btn-row"><button class="btn btn-primary btn-sm" onclick="saveXD()">Save</button><button class="btn btn-ghost btn-sm" onclick="saveXD(true)">Clear</button></div></div>';
}
function saveXD(clear) {
  var id = document.getElementById('xd-h').value;
  var payload = { action: 'updateHolding', id: id, nextXD: clear ? '' : document.getElementById('xd-date').value, nextDividend: clear ? '' : (parseFloat(document.getElementById('xd-amt').value) || '') };
  api(payload).then(function(res) {
    if (!res.ok) { toast('Error: ' + (res.error || '?')); return; }
    toast(clear ? 'Cleared' : 'Saved'); loadAll().then(renderPortfolio);
  }).catch(function(){ toast('Needs a connection'); });
}

// ════════════════════════════════════════════
//  4) TRADING JOURNAL (e.g. XAUUSD)
// ════════════════════════════════════════════
function loadTrades() {
  api({ action: 'getTrades' }).then(function(res) {
    if (!res.ok) { document.getElementById('pf-body').innerHTML = '<div class="empty"><p>' + (/Unknown action/.test(res.error || '') ? 'Update Code.gs in Apps Script and redeploy first.' : 'Could not load trades') + '</p></div>'; return; }
    trades = res.trades.map(function(r) {
      return { id: r[0], ticket: r[1], symbol: r[2], side: r[3], volume: r[4], openTime: r[5], openPrice: r[6], closeTime: r[7], closePrice: r[8],
        commission: r[9], swap: r[10], profit: r[11], account: r[12], note: r[13], currency: r[14] || 'USD', net: Math.round((r[11] + r[9] + r[10]) * 100) / 100 };
    });
    renderPortfolio();
  }).catch(function(){ document.getElementById('pf-body').innerHTML = '<div class="empty"><p>The trading journal needs a connection.</p></div>'; });
}
function usdRate() { var a = accounts.find(function(x){ return x.currency === 'USD' && x.rate; }); return a ? a.rate : 0; }
function fmtUsd(v) { return privacyOn ? '$' + MASK : (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function periodStart(p) {
  var t = todayStr();
  if (p === 'month') return t.substring(0, 7) + '-01';
  if (p === 'year') return t.substring(0, 4) + '-01-01';
  if (p === '30d') return addDaysStr(t, -30);
  return '';
}
function setPfPeriod(p) { pfPeriod = p; renderPortfolio(); }
function tradeStats(list) {
  var closed = list.filter(function(t){ return t.closeTime; }).sort(function(a, b){ return a.closeTime.localeCompare(b.closeTime); });
  var wins = closed.filter(function(t){ return t.net > 0; }), losses = closed.filter(function(t){ return t.net < 0; });
  var sumW = wins.reduce(function(s, t){ return s + t.net; }, 0), sumL = losses.reduce(function(s, t){ return s + t.net; }, 0);
  var eq = 0, peak = 0, dd = 0, curve = [];
  closed.forEach(function(t){ eq += t.net; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); curve.push([t.closeTime, eq]); });
  return { closed: closed, n: closed.length, net: sumW + sumL, wins: wins.length, losses: losses.length,
    winRate: closed.length ? wins.length / closed.length * 100 : 0, avgWin: wins.length ? sumW / wins.length : 0, avgLoss: losses.length ? sumL / losses.length : 0,
    pf: sumL ? sumW / -sumL : (sumW ? Infinity : 0), maxDD: dd, curve: curve,
    lots: closed.reduce(function(s, t){ return s + t.volume; }, 0), costs: closed.reduce(function(s, t){ return s + t.commission + t.swap; }, 0),
    best: closed.reduce(function(b, t){ return !b || t.net > b.net ? t : b; }, null), worst: closed.reduce(function(b, t){ return !b || t.net < b.net ? t : b; }, null),
    open: list.filter(function(t){ return !t.closeTime; }) };
}
function equitySvg(curve) {
  if (curve.length < 2) return '';
  var W = 340, H = 110, pT = 8, pB = 14, n = curve.length;
  var vals = curve.map(function(c){ return c[1]; }).concat([0]), max = Math.max.apply(null, vals), min = Math.min.apply(null, vals);
  if (max === min) max += 1;
  var x = function(i){ return 2 + (W - 4) * i / (n - 1); }, y = function(v){ return pT + (H - pT - pB) * (1 - (v - min) / (max - min)); };
  var d = curve.map(function(c, i){ return (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(c[1]).toFixed(1); }).join('');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="eq-svg" role="img" aria-label="Cumulative profit after each closed trade">' +
    '<line class="eq-zero" x1="0" x2="' + W + '" y1="' + y(0) + '" y2="' + y(0) + '"/>' +
    '<path class="eq-line" d="' + d + '"/>' +
    '<text class="tlbl" x="4" y="' + (H - 2) + '" text-anchor="start">' + fmtDate(curve[0][0].substring(0, 10)) + '</text>' +
    '<text class="tlbl" x="' + (W - 4) + '" y="' + (H - 2) + '" text-anchor="end">' + fmtDate(curve[n - 1][0].substring(0, 10)) + '</text></svg>';
}
function tradingHtml() {
  var from = periodStart(pfPeriod);
  var list = trades.filter(function(t){ return !from || (t.closeTime || t.openTime) >= from; });
  var s = tradeStats(list), rate = usdRate();
  var html = '<div class="bm-presets" style="margin:0 0 12px">' + [['all','All'],['year','This year'],['month','This month'],['30d','30 days']].map(function(p) {
    return '<button class="filter-chip' + (pfPeriod === p[0] ? ' active' : '') + '" onclick="setPfPeriod(\'' + p[0] + '\')">' + p[1] + '</button>'; }).join('') + '</div>';
  if (!trades.length) {
    return html + '<div class="empty"><div class="empty-icon">🥇</div><p>No trades yet. Import your MT5 history or add a trade.</p></div>' + tradingButtons();
  }
  html += '<div class="pf-hero"><div class="pf-hero-l">Net result · ' + s.n + ' closed trade' + (s.n === 1 ? '' : 's') + '</div>' +
    '<div class="pf-hero-v ' + plClass(s.net) + '">' + fmtUsd(s.net) + (rate ? ' <small>≈ ' + signMoney(s.net * rate) + '</small>' : '') + '</div>' +
    '<div class="pf-hero-s">after commission & swap (' + fmtUsd(s.costs) + ')</div></div>';
  html += '<div class="hd-grid" style="margin-bottom:12px">' + [
    ['Win rate', s.winRate.toFixed(0) + '%', s.wins + ' won · ' + s.losses + ' lost'],
    ['Profit factor', s.pf === Infinity ? '∞' : s.pf.toFixed(2), 'wins ÷ losses'],
    ['Avg win / loss', fmtUsd(s.avgWin), fmtUsd(s.avgLoss)],
    ['Max drawdown', fmtUsd(s.maxDD), 'from a peak'],
    ['Best trade', s.best ? fmtUsd(s.best.net) : '—', s.best ? fmtDate(s.best.closeTime.substring(0, 10)) : ''],
    ['Worst trade', s.worst ? fmtUsd(s.worst.net) : '—', s.worst ? fmtDate(s.worst.closeTime.substring(0, 10)) : '']
  ].map(function(x){ return '<div class="hd-stat"><div class="l">' + x[0] + '</div><div class="v">' + x[1] + '</div><div class="s">' + x[2] + '</div></div>'; }).join('') + '</div>';
  if (s.curve.length >= 2) html += '<div class="card"><div class="card-title">Equity curve <span class="trend-sub">cumulative net, ' + s.lots.toFixed(2) + ' lots</span></div>' + equitySvg(s.curve) + '</div>';
  // monthly
  var byM = {}; s.closed.forEach(function(t){ var k = t.closeTime.substring(0, 7); byM[k] = (byM[k] || 0) + t.net; });
  var mk = Object.keys(byM).sort().slice(-12);
  if (mk.length) {
    var mx = Math.max.apply(null, mk.map(function(k){ return Math.abs(byM[k]); }).concat([1]));
    html += '<div class="card"><div class="card-title">By month</div>' + mk.reverse().map(function(k) {
      var v = byM[k], w = Math.abs(v) / mx * 50;
      return '<div class="tm-row"><span class="tm-m">' + SHORT_MON[parseInt(k.substring(5, 7)) - 1] + ' ' + k.substring(2, 4) + '</span>' +
        '<span class="tm-track"><span class="tm-bar ' + (v >= 0 ? 'pos' : 'neg') + '" style="width:' + w + '%;' + (v >= 0 ? 'left:50%' : 'right:50%') + '"></span></span>' +
        '<span class="tm-v ' + plClass(v) + '">' + fmtUsd(v) + '</span></div>';
    }).join('') + '</div>';
  }
  // by symbol & side
  var groups = {};
  s.closed.forEach(function(t){ [t.symbol, t.side === 'buy' ? 'Long (buy)' : 'Short (sell)'].forEach(function(g, i) {
    var k = (i ? 'side|' : 'sym|') + g; groups[k] = groups[k] || { n: 0, w: 0, net: 0, label: g }; groups[k].n++; if (t.net > 0) groups[k].w++; groups[k].net += t.net; }); });
  var gk = Object.keys(groups);
  html += '<div class="card"><div class="card-title">Breakdown</div>' + gk.sort().map(function(k) {
    var g = groups[k];
    return '<div class="bm-row"><span>' + recEsc(g.label) + ' <span class="pr-s">· ' + g.n + (g.n === 1 ? ' trade · ' : ' trades · ') + Math.round(g.w / g.n * 100) + '% won</span></span><b class="' + plClass(g.net) + '">' + fmtUsd(g.net) + '</b></div>';
  }).join('') + '</div>';
  // list
  var recent = list.slice().sort(function(a, b){ return (b.closeTime || b.openTime).localeCompare(a.closeTime || a.openTime); });
  html += '<div class="card"><div class="card-title">Trades <span class="trend-sub">' + recent.length + (s.open.length ? ' · ' + s.open.length + ' open' : '') + '</span></div>' +
    recent.slice(0, tjShowAll ? 1000 : 30).map(function(t) {
      return '<div class="hd-txn"><div><div class="t">' + (t.side === 'buy' ? '▲ Buy' : '▼ Sell') + ' ' + recEsc(t.symbol) + ' ' + t.volume + '</div>' +
        '<div class="d">' + (t.openTime ? t.openTime.substring(5) : '') + (t.openPrice ? ' @ ' + t.openPrice : '') + (t.closeTime ? ' → ' + t.closeTime.substring(5) + (t.closePrice ? ' @ ' + t.closePrice : '') : ' · open') +
        (t.account ? ' · ' + recEsc(t.account) : '') + (t.note ? ' · ' + recEsc(t.note) : '') + '</div></div>' +
        '<div class="a ' + (t.closeTime ? plClass(t.net) : 'pl-zero') + '">' + (t.closeTime ? fmtUsd(t.net) : '—') + '</div>' +
        '<button title="Delete" onclick="deleteTrade(\'' + escQ(t.id) + '\')">✕</button></div>';
    }).join('') + (recent.length > 30 && !tjShowAll ? '<button class="pf-link" style="margin-top:8px" onclick="tjShowAll=true;renderPortfolio()">Show all ' + recent.length + '</button>' : '') + '</div>';
  return html + tradingButtons();
}
var tjShowAll = false;
function tradingButtons() {
  return '<div class="btn-row" style="margin-top:4px"><button class="btn btn-primary btn-sm" onclick="openTradeForm()">+ Add trade</button>' +
    '<button class="btn btn-ghost btn-sm" onclick="document.getElementById(\'tj-file\').click()">⬆ Import MT5 report</button></div>' +
    '<div class="pf-note">MT5: History tab → right-click → Report → HTML (or Open XML), then pick the file here. CSV with a header row also works. Trades already saved are skipped.</div>';
}
function deleteTrade(id) {
  if (!confirm('Delete this trade?')) return;
  api({ action: 'deleteTrade', id: id }).then(function(res) {
    if (!res.ok) { toast('Error: ' + (res.error || '?')); return; }
    trades = trades.filter(function(t){ return t.id !== id; }); renderPortfolio(); toast('Deleted'); loadAll();
  }).catch(function(){ toast('Needs a connection'); });
}
function tjAccountOptions() {
  return '<option value="">— Journal only (no account) —</option>' + sortedAccounts().filter(function(a){ return a.type !== 'credit'; })
    .map(function(a){ return '<option value="' + escAttr(a.name) + '">' + acctIcon(a.type) + ' ' + recEsc(a.name) + (a.currency !== 'THB' ? ' (' + a.currency + ')' : '') + '</option>'; }).join('');
}
function openTradeForm() {
  document.getElementById('tj-account').innerHTML = tjAccountOptions();
  var last = trades && trades.length ? trades[trades.length - 1] : null;
  document.getElementById('tj-symbol').value = last ? last.symbol : 'XAUUSD';
  if (last && last.account) document.getElementById('tj-account').value = last.account;
  ['tj-volume','tj-open-price','tj-close-price','tj-commission','tj-swap','tj-profit','tj-note'].forEach(function(i){ document.getElementById(i).value = ''; });
  var n = new Date(), local = n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate()) + 'T' + pad(n.getHours()) + ':' + pad(n.getMinutes());
  document.getElementById('tj-open-time').value = local; document.getElementById('tj-close-time').value = local;
  document.getElementById('tj-side').value = 'buy';
  openModal('tj-modal');
}
function saveTradeForm() {
  var g = function(i){ return document.getElementById(i).value; };
  var t = { action: 'addTrade', id: newClientId('K'), symbol: g('tj-symbol').trim(), side: g('tj-side'), volume: parseFloat(g('tj-volume')),
    openTime: g('tj-open-time').replace('T', ' '), openPrice: parseFloat(g('tj-open-price')) || 0,
    closeTime: g('tj-close-time').replace('T', ' '), closePrice: parseFloat(g('tj-close-price')) || 0,
    commission: parseFloat(g('tj-commission')) || 0, swap: parseFloat(g('tj-swap')) || 0, profit: parseFloat(g('tj-profit')) || 0,
    account: g('tj-account'), note: g('tj-note').trim(), currency: 'USD' };
  if (!t.symbol || !(t.volume > 0)) { toast('Enter symbol and lots'); return; }
  if (t.closeTime && !g('tj-profit')) { toast('Enter the profit / loss ($)'); return; }
  api(t).then(function(res) {
    if (!res.ok) { toast(/Unknown action/.test(res.error || '') ? 'Update Code.gs in Apps Script and redeploy first' : 'Error: ' + (res.error || '?')); return; }
    closeModal('tj-modal'); toast('Trade saved'); trades = null; renderPortfolio(); loadAll();
  }).catch(function(){ toast('Needs a connection'); });
}

// ── MT5 / MT4 report import (parsed here on your device) ──
var COLS = {
  ticket: /^(position|ticket|deal|order)$/, symbol: /^(symbol|item)$/, side: /^type$/, volume: /^(volume|size|lots?)$/,
  openTime: /^(open time|time)$/, openPrice: /^(open price|price)$/, closeTime: /^(close time|time)$/, closePrice: /^(close price|price)$/,
  commission: /^commission$/, swap: /^swap$/, profit: /^profit$/, taxes: /^taxes$/
};
function num(v) { var s = String(v == null ? '' : v).replace(/\s/g, '').replace(/,(?=\d{3}(\D|$))/g, ''); var m = s.match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : 0; }
function mapHeader(cells) {
  var h = cells.map(function(c){ return String(c).toLowerCase().replace(/\s+/g, ' ').replace(/\s*\/\s*/g, '/').trim(); }), idx = {}, timeSeen = 0, priceSeen = 0;
  h.forEach(function(name, i) {
    if (name === 'time') { idx[timeSeen++ ? 'closeTime' : 'openTime'] = i; return; }
    if (name === 'price') { idx[priceSeen++ ? 'closePrice' : 'openPrice'] = i; return; }
    Object.keys(COLS).forEach(function(k){ if (idx[k] === undefined && COLS[k].test(name)) idx[k] = i; });
  });
  return (idx.symbol !== undefined && idx.profit !== undefined && idx.side !== undefined && idx.volume !== undefined) ? idx : null;
}
function rowToTrade(cells, idx) {
  var side = String(cells[idx.side] || '').toLowerCase().trim();
  if (side !== 'buy' && side !== 'sell') return null;                 // skip balance, deposit, pending orders…
  var g = function(k){ return idx[k] !== undefined ? cells[idx[k]] : ''; };
  return { ticket: String(g('ticket')).trim(), symbol: String(g('symbol')).trim().toUpperCase(), side: side, volume: num(String(g('volume')).split('/')[0]),
    openTime: String(g('openTime')).trim(), openPrice: num(g('openPrice')), closeTime: String(g('closeTime')).trim(), closePrice: num(g('closePrice')),
    commission: num(g('commission')) + num(g('taxes')), swap: num(g('swap')), profit: num(g('profit')), currency: 'USD' };
}
function parseTradeTable(rows) {                 // rows: arrays of cell texts; finds the "Positions" / "Closed Transactions" table
  var out = [], idx = null;
  rows.forEach(function(cells) {
    if (cells.filter(function(c){ return c; }).length <= 2) {          // section title rows: stop at the next section
      if (/^\s*(orders|deals|working orders|open positions|summary|results)\b/i.test(cells.join(' '))) idx = null;
      return;
    }
    var m = mapHeader(cells);
    if (m) { idx = m; return; }
    if (!idx) return;
    var t = rowToTrade(cells, idx);
    if (t && t.symbol && t.volume > 0) out.push(t);
  });
  var seen = {};
  return out.filter(function(t){ if (!t.ticket) return true; if (seen[t.ticket]) return false; seen[t.ticket] = true; return true; });
}
function decodeReport(buf) {
  var b = new Uint8Array(buf);
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf);
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf);
  return new TextDecoder('utf-8').decode(buf);
}
function parseReportText(text, name) {
  if (/<table/i.test(text) || /\.html?$/i.test(name)) {
    var doc = new DOMParser().parseFromString(text, 'text/html');
    var rows = Array.prototype.map.call(doc.querySelectorAll('tr'), function(tr) {
      var out = [];
      Array.prototype.forEach.call(tr.children, function(td) { if (td.classList && td.classList.contains('hidden')) return; var span = parseInt(td.getAttribute('colspan')) || 1; out.push(td.textContent.trim()); for (var i = 1; i < span && span < 8; i++) out.push(''); });
      return out;
    });
    return parseTradeTable(rows);
  }
  if (/<\?xml|<Workbook/i.test(text)) {        // MT5 "Open XML" (SpreadsheetML)
    var x = new DOMParser().parseFromString(text, 'application/xml');
    var rowsX = Array.prototype.map.call(x.getElementsByTagName('Row'), function(r) {
      return Array.prototype.map.call(r.getElementsByTagName('Cell'), function(c){ return c.textContent.trim(); });
    });
    return parseTradeTable(rowsX);
  }
  var lines = text.split(/\r?\n/).filter(function(l){ return l.trim(); });
  var sep = (lines[0].match(/\t/g) || []).length ? '\t' : (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  return parseTradeTable(lines.map(function(l){ return l.split(sep).map(function(c){ return c.replace(/^"|"$/g, '').trim(); }); }));
}
var tjPending = null;
function onTradeFile(input) {
  var f = input.files && input.files[0]; input.value = '';
  if (!f) return;
  f.arrayBuffer().then(function(buf) {
    var list = parseReportText(decodeReport(buf), f.name);
    if (!list.length) { toast('No trades found in that file — send me a sample if it\'s an MT5 report', 5000); return; }
    var have = {}; (trades || []).forEach(function(t){ if (t.ticket) have[t.ticket] = true; });
    var fresh = list.filter(function(t){ return !t.ticket || !have[t.ticket]; });
    var closed = list.filter(function(t){ return t.closeTime; });
    var dates = closed.map(function(t){ return t.closeTime.substring(0, 10).replace(/\./g, '-'); }).sort();
    var net = closed.reduce(function(s, t){ return s + t.profit + t.commission + t.swap; }, 0);
    tjPending = list;
    document.getElementById('tji-summary').innerHTML = '<b>' + list.length + ' trades</b> in ' + recEsc(f.name) +
      (dates.length ? '<br>' + fmtDateY(dates[0]) + ' – ' + fmtDateY(dates[dates.length - 1]) : '') +
      '<br>Net result ' + fmtUsd(net) + (list.length - fresh.length ? '<br>' + (list.length - fresh.length) + ' already saved — will be skipped' : '');
    document.getElementById('tji-account').innerHTML = tjAccountOptions();
    var usd = accounts.find(function(a){ return a.currency === 'USD'; }); if (usd) document.getElementById('tji-account').value = usd.name;
    openModal('tj-import-modal');
  });
}
function confirmTradeImport() {
  if (!tjPending) return;
  var btn = document.getElementById('tji-go'); btn.textContent = 'Importing…';
  api({ action: 'importTrades', account: document.getElementById('tji-account').value, trades: tjPending }).then(function(res) {
    btn.textContent = 'Import';
    if (!res.ok) { toast(/Unknown action/.test(res.error || '') ? 'Update Code.gs in Apps Script and redeploy first' : 'Error: ' + (res.error || '?')); return; }
    closeModal('tj-import-modal'); tjPending = null;
    toast('Imported ' + res.added + ' trade' + (res.added === 1 ? '' : 's') + (res.skipped ? ' · ' + res.skipped + ' skipped' : ''), 4000);
    trades = null; pfTab = 'trading'; renderPortfolio(); loadAll();
  }).catch(function(){ btn.textContent = 'Import'; toast('Needs a connection'); });
}

// ── dashboard heads-up when the mix drifts 5+ points from a target ──
function allocationNudges() {
  var out = [], ym = todayStr().substring(0, 7);
  allocDrifts().forEach(function(d) {
    if (Math.abs(d.drift) < 5) return;
    var key = 'a|' + d.cls + '|' + ym;
    if (isDismissed(key)) return;
    out.push({ key: key, until: ym + '-31', icon: '🥧', prio: 0,
      text: '<b>' + recEsc(d.cls) + '</b> is ' + d.actual.toFixed(0) + '% of your investments — your target is ' + d.target + '% (' + (d.drift > 0 ? '+' : '−') + Math.abs(d.drift).toFixed(0) + ' pts).',
      actions: [['See allocation', "openPortfolio('allocation')"]] });
  });
  return out;
}
