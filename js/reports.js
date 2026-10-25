// Money Tracker — Year in Review and Excel export.
// Loaded as a plain <script> (not a module): functions are global so onclick="..." handlers work.

// ════════════════════════════════════════════
//  ANNUAL SUMMARY
// ════════════════════════════════════════════
function showAnnualSummary(year) {
  annualSummaryYear = year || viewYear;
  document.getElementById('annual-year-label').textContent = annualSummaryYear;
  document.getElementById('annual-summary-content').innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';
  var overlay = document.getElementById('annual-summary-modal');
  overlay.classList.add('open');
  overlay.onclick = function(e){ if(e.target===overlay){ closeAnnualSummary(); } };
  fetchAndRenderAnnualSummary();
}

function closeAnnualSummary() {
  document.getElementById('annual-summary-modal').classList.remove('open');
}

function changeAnnualYear(d) {
  annualSummaryYear += d;
  document.getElementById('annual-year-label').textContent = annualSummaryYear;
  document.getElementById('annual-summary-content').innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';
  fetchAndRenderAnnualSummary();
}

function fetchAndRenderAnnualSummary() {
  api({action:'getAnnualSummary', year:annualSummaryYear}).then(function(res){
    if (!res.ok) { document.getElementById('annual-summary-content').innerHTML = '<div class="empty"><p>Could not load data</p></div>'; return; }
    renderAnnualSummaryContent(res);
  }).catch(function(){
    document.getElementById('annual-summary-content').innerHTML = '<div class="empty"><p>Connection error</p></div>';
  });
}

function renderAnnualSummaryContent(res) {
  var totalInc = res.totalIncome || 0;
  var totalExp = res.totalExpenses || 0;
  var surplus = totalInc - totalExp;
  var savingsRate = totalInc > 0 ? Math.round(surplus / totalInc * 100) : 0;
  var monthly = res.monthly || [];
  var catBreakdown = res.categories || res.categoryBreakdown || [];
  monthly.forEach(function(m){ if (m.expenses === undefined) m.expenses = (m.regularExpenses||0) + (m.projectExpenses||0); });
  var maxVal = 0;
  monthly.forEach(function(m){ if((m.income||0)>maxVal) maxVal=m.income; if((m.expenses||0)>maxVal) maxVal=m.expenses; });
  if (maxVal === 0) maxVal = 1;
  var shortMonths = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  var barsHtml = monthly.map(function(m, i){
    var incH = Math.round((m.income||0)/maxVal*76);
    var expH = Math.round((m.expenses||0)/maxVal*76);
    return '<div class="month-bar-group"><div class="month-bar-pair"><div class="month-bar-inc" style="height:'+incH+'px"></div><div class="month-bar-exp" style="height:'+expH+'px"></div></div><div class="month-bar-lbl">'+(shortMonths[i]||'')+'</div></div>';
  }).join('');
  var catHtml = catBreakdown.slice(0,8).map(function(c){
    var pct = totalExp > 0 ? Math.round((c.amount||0)/totalExp*100) : 0;
    return '<div class="annual-cat-row"><div class="annual-cat-icon">'+catIcon(c.category)+'</div><div class="annual-cat-name">'+escQ(c.category||'Other')+'</div><div class="annual-cat-pct">'+pct+'%</div><div class="annual-cat-amt">'+fmtMoney(c.amount||0)+'</div></div>';
  }).join('');
  var srColor = savingsRate >= 20 ? 'var(--income-color)' : savingsRate >= 0 ? 'var(--transfer-color)' : 'var(--expense-color)';
  var html = '<div class="savings-rate-hero"><div class="savings-rate-pct">'+savingsRate+'%</div><div class="savings-rate-label">Savings Rate</div></div>' +
    '<div class="annual-metric-grid"><div class="annual-metric"><div class="annual-metric-val" style="color:var(--income-color)">'+fmtMoney(totalInc)+'</div><div class="annual-metric-label">Total Income</div></div><div class="annual-metric"><div class="annual-metric-val" style="color:var(--expense-color)">'+fmtMoney(totalExp)+'</div><div class="annual-metric-label">Total Expenses</div></div><div class="annual-metric"><div class="annual-metric-val" style="color:'+(surplus>=0?'var(--income-color)':'var(--expense-color)')+'">'+fmtMoney(surplus)+'</div><div class="annual-metric-label">'+(surplus>=0?'Surplus':'Deficit')+'</div></div><div class="annual-metric"><div class="annual-metric-val" style="color:'+srColor+'">'+savingsRate+'%</div><div class="annual-metric-label">Saved</div></div></div>' +
    '<div class="card" style="margin-bottom:12px"><div class="card-title">Month by Month</div><div style="display:flex;gap:10px;font-size:0.68rem;color:var(--text2);margin-bottom:6px"><span style="color:var(--income-color)">▌ Income</span><span style="color:var(--expense-color)">▌ Expenses</span></div><div class="month-bars">'+barsHtml+'</div></div>' +
    '<div class="card"><div class="card-title">Category Breakdown</div>'+(catHtml || '<div class="empty" style="padding:20px"><p>No expense data</p></div>')+'</div>';
  document.getElementById('annual-summary-content').innerHTML = html;
}

// ════════════════════════════════════════════
//  EXPORT TO EXCEL
// ════════════════════════════════════════════
function exportMonth() {
  if (typeof XLSX === 'undefined') { toast('SheetJS not loaded'); return; }
  var txnRows = [['Date','Type','Category','Amount','Account','Note']];
  transactions.forEach(function(t){
    txnRows.push([t.date||'',t.type||'',t.type==='transfer'?'Transfer':(t.category||''),t.amount||0,t.type==='transfer'?(t.fromAccount+' → '+t.toAccount):(t.account||''),t.note||'']);
  });
  var acctRows = [['Account','Type','Balance']];
  accounts.forEach(function(a){ acctRows.push([a.name, a.type, a.balance||0]); });
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(txnRows), 'Transactions');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(acctRows), 'Accounts');
  var fname = 'MoneyTracker_'+viewYear+'_'+pad(viewMonth)+'.xlsx';
  XLSX.writeFile(wb, fname);
  toast('Exported: '+fname);
}

function exportYear() {
  if (typeof XLSX === 'undefined') { toast('SheetJS not loaded'); return; }
  toast('Fetching year data…');
  api({action:'getAnnualSummary', year:viewYear}).then(function(res){
    var summaryRows = [['Month','Income','Expenses','Net']];
    if (res.ok && res.monthly) {
      res.monthly.forEach(function(m, i){ var ex = m.expenses !== undefined ? m.expenses : (m.regularExpenses||0) + (m.projectExpenses||0); summaryRows.push([MONTH_NAMES[i], m.income||0, ex, (m.income||0)-ex]); });
    }
    var txnRows = [['Date','Type','Category','Amount','Account','Note']];
    transactions.forEach(function(t){
      txnRows.push([t.date||'',t.type||'',t.type==='transfer'?'Transfer':(t.category||''),t.amount||0,t.type==='transfer'?(t.fromAccount+' → '+t.toAccount):(t.account||''),t.note||'']);
    });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(txnRows), 'Transactions');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Monthly Summary');
    var fname = 'MoneyTracker_'+viewYear+'.xlsx';
    XLSX.writeFile(wb, fname);
    toast('Exported: '+fname);
  }).catch(function(){ toast('Export failed'); });
}
