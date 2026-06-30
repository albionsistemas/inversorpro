/**
 * dashboard.js — Lógica del frontend de InversorPro
 *
 * Responsabilidades:
 *   - Cargar datos del dashboard desde la API al iniciar
 *   - Renderizar todas las secciones del dashboard
 *   - Manejar la navegación por tabs sin recargar la página
 *   - Botón "Actualizar Datos" → AJAX fetch a /api/refresh
 *   - CRUD del portfolio (agregar / eliminar posiciones)
 */

// ── Estado global de la aplicación ──────────────────────────────────────────
let dashboardData   = null;
let portfolioData   = null;
let activeTab       = 'overview';
let activeSignalFilter = 'all';
let isLoading       = false;

// ── Auth helpers ──────────────────────────────────────────────────────────────

// Intercepta respuestas 401 y redirige al login
function handleUnauth(res) {
  if (res.status === 401) {
    window.location.replace('/login.html');
    return true;
  }
  return false;
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.replace('/login.html');
}

// ── Inicialización ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
  loadPortfolio();
});

// ── Carga y refresco de datos ─────────────────────────────────────────────────

async function loadDashboard() {
  try {
    setLoading(true);
    const res  = await fetch('/api/dashboard');
    if (handleUnauth(res)) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    dashboardData = await res.json();
    renderAll(dashboardData);
    hideError();
    updateTimestamp(dashboardData.meta.updatedAt);
  } catch (err) {
    showError('No se pudo conectar con el servidor. ¿Está corriendo InversorPro?');
    console.error('[Dashboard] Error al cargar:', err);
  } finally {
    setLoading(false);
  }
}

async function loadPortfolio() {
  try {
    const res = await fetch('/api/portfolio');
    if (handleUnauth(res)) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    portfolioData = await res.json();
    renderPortfolio(portfolioData);
  } catch (err) {
    console.error('[Portfolio] Error al cargar:', err);
  }
}

/** Función llamada por el botón "Actualizar Datos" */
async function refreshData() {
  if (isLoading) return;
  try {
    setLoading(true);
    const res  = await fetch('/api/refresh');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    dashboardData = result.data;
    renderAll(dashboardData);
    updateTimestamp(result.refreshedAt);
    hideError();
    await loadPortfolio();
  } catch (err) {
    showError('Error al actualizar. Revisá la conexión.');
    console.error('[Refresh]', err);
  } finally {
    setLoading(false);
  }
}

// ── Renderizado principal ─────────────────────────────────────────────────────

function renderAll(data) {
  renderKPIs(data);
  renderTopBuys(data.topBuys);
  renderWhaleSummary(data.whales?.institutional?.slice(0, 3) ?? []);
  renderSignalsTable(data.signals);
  renderCryptoTable(data.crypto);
  renderUSTable(data.usStocks);
  renderDollarGrid(data.dollarRates);
  renderMervalTable(data.argentina?.stocks ?? []);
  renderCedearsTable(data.argentina?.cedears ?? []);
  renderInstitutionalList(data.whales?.institutional ?? []);
  renderCryptoWhalesList(data.whales?.cryptoWhales ?? []);
  renderFearGreedBadge(data.fearGreed);
}

// ── KPIs (métricas principales) ────────────────────────────────────────────────

function renderKPIs(data) {
  // Fear & Greed
  const fg = data.fearGreed ?? { value: 50, label: 'Neutral' };
  document.getElementById('kpi-fear-greed').textContent = fg.value;
  document.getElementById('kpi-fear-label').textContent  = fg.label;
  const fill = document.getElementById('fear-fill');
  fill.style.width = `${fg.value}%`;
  fill.className = `h-full rounded-full transition-all duration-700 ${
    fg.value < 25 ? 'bg-red-500' : fg.value < 45 ? 'bg-orange-500' :
    fg.value < 55 ? 'bg-yellow-500' : fg.value < 75 ? 'bg-lime-500' : 'bg-green-500'
  }`;

  // Dólar MEP y Blue
  const mep  = (data.dollarRates ?? []).find(d => d.nombre?.toLowerCase().includes('mep') || d.nombre?.toLowerCase().includes('bolsa'));
  const blue = (data.dollarRates ?? []).find(d => d.nombre?.toLowerCase() === 'blue');
  if (mep)  document.getElementById('kpi-mep').textContent = `$${formatNum(mep.venta, 0)}`;
  if (blue) document.getElementById('kpi-mep-blue').textContent = `Blue: $${formatNum(blue.venta, 0)}`;

  // Merval
  const merval = data.argentina?.mervalIndex;
  if (merval) {
    document.getElementById('kpi-merval').textContent = formatLargeNum(merval.value);
    const mEl = document.getElementById('kpi-merval-change');
    mEl.textContent  = `${merval.change24h > 0 ? '+' : ''}${merval.change24h.toFixed(2)}%`;
    mEl.className    = `text-xs mt-1 font-medium ${merval.change24h >= 0 ? 'up' : 'down'}`;
  }

  // Señales activas
  const signals = data.signals ?? [];
  const buys    = signals.filter(s => s.signalCode === 'BUY').length;
  const sells   = signals.filter(s => s.signalCode === 'SELL').length;
  document.getElementById('kpi-signals').textContent    = signals.length;
  document.getElementById('kpi-signals-sub').textContent = `${buys} comprar · ${sells} vender`;
}

// ── Top oportunidades ──────────────────────────────────────────────────────────

function renderTopBuys(buys = []) {
  const el = document.getElementById('top-buys');
  if (!buys.length) { el.innerHTML = '<p class="text-slate-500 text-sm text-center py-4">Sin señales de compra activas</p>'; return; }

  el.innerHTML = buys.slice(0, 5).map(s => `
    <div class="flex items-start justify-between p-3 rounded-lg bg-green-500/5 border border-green-500/20 gap-3">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-bold text-white">${s.symbol}</span>
          <span class="text-xs text-slate-400">${typeLabel(s.type)}</span>
        </div>
        <p class="text-xs text-slate-400 mt-0.5 line-clamp-2">${s.reason}</p>
      </div>
      <div class="text-right shrink-0">
        <div class="font-semibold text-white text-sm">${fmtPrice(s.price, s.type)}</div>
        <div class="${s.change24h >= 0 ? 'up' : 'down'} text-xs">${s.change24h >= 0 ? '+' : ''}${s.change24h.toFixed(2)}%</div>
      </div>
    </div>
  `).join('');
}

// ── Ballenas en resumen ────────────────────────────────────────────────────────

function renderWhaleSummary(moves = []) {
  const el = document.getElementById('whale-summary');
  if (!moves.length) { el.innerHTML = '<p class="text-slate-500 text-sm text-center py-4">Sin datos</p>'; return; }

  el.innerHTML = moves.map(m => `
    <div class="flex items-center gap-3 p-3 rounded-lg bg-slate-700/30 border border-slate-700/50">
      <span class="text-lg">${m.action === 'BUY' ? '🟢' : m.action === 'SELL' ? '🔴' : '🟡'}</span>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-semibold text-white text-sm">${m.investor}</span>
          <span class="badge ${m.action === 'BUY' ? 'signal-buy' : m.action === 'SELL' ? 'signal-sell' : 'signal-hold'}">${m.action === 'BUY' ? 'COMPRA' : m.action === 'SELL' ? 'VENTA' : 'HOLD'}</span>
          <span class="font-bold text-blue-400 text-sm">${m.asset}</span>
        </div>
        <p class="text-xs text-slate-400 mt-0.5 truncate">${m.rationale || m.detail || ''}</p>
      </div>
      <div class="text-right shrink-0">
        <div class="text-sm font-semibold text-white">${fmtMillions(m.amountUsd)}</div>
        <div class="text-xs text-slate-500">${m.quarter || 'Reciente'}</div>
      </div>
    </div>
  `).join('');
}

// ── Tabla de señales ──────────────────────────────────────────────────────────

function filterSignals(filter) {
  activeSignalFilter = filter;
  document.querySelectorAll('.sig-filter').forEach(b => {
    b.className = 'sig-filter px-3 py-1 rounded-full text-slate-400 text-xs';
  });
  const active = document.getElementById(`f-${filter}`);
  if (active) active.className = 'sig-filter px-3 py-1 rounded-full bg-slate-700 text-slate-300 text-xs font-medium';
  if (dashboardData) renderSignalsTable(dashboardData.signals);
}

function renderSignalsTable(signals = []) {
  const filtered = activeSignalFilter === 'all'
    ? signals
    : signals.filter(s => s.signalCode === activeSignalFilter);

  const tbody = document.getElementById('signals-table');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-slate-500 text-sm">No hay señales para este filtro</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(s => `
    <tr class="hover:bg-slate-700/30 transition-colors">
      <td class="px-4 py-3">
        <div class="font-semibold text-white">${s.symbol}</div>
        <div class="text-xs text-slate-400 truncate max-w-[120px]">${s.name}</div>
      </td>
      <td class="px-4 py-3 text-right font-mono text-slate-200">${fmtPrice(s.price, s.type)}</td>
      <td class="px-4 py-3 text-right font-medium ${s.change24h >= 0 ? 'up' : 'down'}">${s.change24h >= 0 ? '+' : ''}${s.change24h.toFixed(2)}%</td>
      <td class="px-4 py-3 text-center">
        <span class="badge ${s.signalCode === 'BUY' ? 'signal-buy' : s.signalCode === 'SELL' ? 'signal-sell' : 'signal-hold'}">
          ${s.signal}
        </span>
      </td>
      <td class="px-4 py-3 text-center hidden sm:table-cell">
        <span class="text-xs text-slate-400">${s.confidence}</span>
      </td>
      <td class="px-4 py-3 text-center hidden md:table-cell">
        <span class="text-xs font-mono ${s.score > 0 ? 'text-green-400' : s.score < 0 ? 'text-red-400' : 'text-slate-400'}">${s.score > 0 ? '+' : ''}${s.score}</span>
      </td>
      <td class="px-4 py-3 hidden lg:table-cell">
        <p class="text-xs text-slate-400 max-w-xs line-clamp-2">${s.reason}</p>
      </td>
    </tr>
  `).join('');
}

// ── Tabla Crypto ───────────────────────────────────────────────────────────────

function renderCryptoTable(coins = []) {
  const tbody = document.getElementById('crypto-table');
  if (!coins.length) { tbody.innerHTML = noDataRow(8); return; }

  tbody.innerHTML = coins.map(c => `
    <tr class="hover:bg-slate-700/30 transition-colors">
      <td class="px-4 py-3 text-slate-400 text-sm">${c.rank ?? '—'}</td>
      <td class="px-4 py-3">
        <div class="font-semibold text-white">${c.symbol}</div>
        <div class="text-xs text-slate-400">${c.name}</div>
      </td>
      <td class="px-4 py-3 text-right font-mono text-slate-200">$${formatNum(c.price, c.price < 1 ? 4 : c.price < 100 ? 2 : 0)}</td>
      <td class="px-4 py-3 text-right ${c.change1h >= 0 ? 'up' : 'down'} font-medium">${fmt24h(c.change1h)}</td>
      <td class="px-4 py-3 text-right ${c.change24h >= 0 ? 'up' : 'down'} font-medium">${fmt24h(c.change24h)}</td>
      <td class="px-4 py-3 text-right hidden sm:table-cell ${c.change7d >= 0 ? 'up' : 'down'}">${fmt24h(c.change7d)}</td>
      <td class="px-4 py-3 text-right hidden md:table-cell text-slate-300">${formatLargeNum(c.volume24h)}</td>
      <td class="px-4 py-3 text-right hidden lg:table-cell text-slate-300">${formatLargeNum(c.marketCap)}</td>
    </tr>
  `).join('');
}

// ── Tabla US Stocks ────────────────────────────────────────────────────────────

function renderUSTable(stocks = []) {
  const tbody = document.getElementById('us-table');
  if (!stocks.length) { tbody.innerHTML = noDataRow(8); return; }

  tbody.innerHTML = stocks.map(s => `
    <tr class="hover:bg-slate-700/30 transition-colors">
      <td class="px-4 py-3 font-bold text-white">${s.symbol}</td>
      <td class="px-4 py-3 hidden sm:table-cell text-slate-300 text-sm">${s.name}</td>
      <td class="px-4 py-3 text-right font-mono text-slate-200">$${formatNum(s.price, 2)}</td>
      <td class="px-4 py-3 text-right font-medium ${s.change24h >= 0 ? 'up' : 'down'}">${fmt24h(s.change24h)} <span class="text-xs opacity-60">(${s.change24h >= 0 ? '+' : ''}$${Math.abs(s.changeAbs).toFixed(2)})</span></td>
      <td class="px-4 py-3 text-right hidden md:table-cell text-slate-400">${s.peRatio ? s.peRatio.toFixed(1) : '—'}</td>
      <td class="px-4 py-3 text-right hidden md:table-cell text-slate-300">${formatLargeNum(s.marketCap)}</td>
      <td class="px-4 py-3 text-right hidden lg:table-cell text-slate-400">$${formatNum(s.high52w, 2)}</td>
      <td class="px-4 py-3 text-right hidden lg:table-cell text-slate-400">$${formatNum(s.low52w, 2)}</td>
    </tr>
  `).join('');
}

// ── Cotizaciones dólar ─────────────────────────────────────────────────────────

function renderDollarGrid(rates = []) {
  const el = document.getElementById('dollar-grid');
  if (!rates.length) { el.innerHTML = '<p class="text-slate-500 text-sm col-span-6">Sin datos</p>'; return; }

  el.innerHTML = rates.map(d => `
    <div class="bg-slate-700/30 border border-slate-600/50 rounded-xl p-3 text-center">
      <p class="text-xs text-slate-400 font-medium mb-2 uppercase tracking-wider">${d.nombre}</p>
      ${d.compra > 0 ? `<p class="text-xs text-slate-500">Compra: <span class="text-slate-300">$${formatNum(d.compra, 0)}</span></p>` : ''}
      <p class="text-lg font-bold text-white mt-1">$${formatNum(d.venta, 0)}</p>
      ${d.spread > 0 ? `<p class="text-xs text-slate-500 mt-1">Spread ${d.spread}%</p>` : ''}
    </div>
  `).join('');
}

// ── Tablas Argentina ───────────────────────────────────────────────────────────

function renderMervalTable(stocks = []) {
  const tbody = document.getElementById('merval-table');
  if (!stocks.length) { tbody.innerHTML = noDataRow(4); return; }

  tbody.innerHTML = stocks.map(s => `
    <tr class="hover:bg-slate-700/30 transition-colors">
      <td class="px-4 py-3">
        <div class="font-bold text-white">${s.symbol}</div>
        <div class="text-xs text-slate-400">${s.name}</div>
      </td>
      <td class="px-4 py-3 text-right font-mono text-slate-200">$${formatNum(s.priceArs, 0)}</td>
      <td class="px-4 py-3 text-right font-mono text-slate-400">U$S ${formatNum(s.priceUsdMep, 2)}</td>
      <td class="px-4 py-3 text-right font-medium ${s.change24h >= 0 ? 'up' : 'down'}">${fmt24h(s.change24h)}</td>
    </tr>
  `).join('');
}

function renderCedearsTable(cedears = []) {
  const tbody = document.getElementById('cedears-table');
  if (!cedears.length) { tbody.innerHTML = noDataRow(4); return; }

  tbody.innerHTML = cedears.map(c => `
    <tr class="hover:bg-slate-700/30 transition-colors">
      <td class="px-4 py-3">
        <div class="font-bold text-white">${c.symbol}</div>
        <div class="text-xs text-slate-400">${c.name}</div>
      </td>
      <td class="px-4 py-3 text-right font-mono text-slate-200">$${formatNum(c.priceArs, 0)}</td>
      <td class="px-4 py-3 text-right font-mono text-slate-400">U$S ${formatNum(c.priceUsdMep, 2)}</td>
      <td class="px-4 py-3 text-right font-medium ${c.change24h >= 0 ? 'up' : 'down'}">${fmt24h(c.change24h)}</td>
    </tr>
  `).join('');
}

// ── Ballenas / Institucionales ─────────────────────────────────────────────────

function renderInstitutionalList(moves = []) {
  const el = document.getElementById('institutional-list');
  if (!moves.length) { el.innerHTML = '<p class="text-slate-500 text-sm text-center py-4">Sin datos</p>'; return; }

  el.innerHTML = moves.map(m => `
    <div class="flex items-start gap-4 p-4 rounded-xl bg-slate-700/20 border border-slate-700/40">
      <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${m.action === 'BUY' ? 'bg-green-500/20' : m.action === 'SELL' ? 'bg-red-500/20' : 'bg-yellow-500/20'}">
        <span class="text-lg">${m.action === 'BUY' ? '📈' : m.action === 'SELL' ? '📉' : '⏸️'}</span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex flex-wrap items-center gap-2 mb-1">
          <span class="font-semibold text-white text-sm">${m.investor}</span>
          <span class="badge ${m.action === 'BUY' ? 'signal-buy' : m.action === 'SELL' ? 'signal-sell' : 'signal-hold'}">${m.action === 'BUY' ? 'COMPRA' : m.action === 'SELL' ? 'VENTA' : 'HOLD'}</span>
          <span class="font-bold text-blue-400">${m.asset}</span>
          <span class="text-xs text-slate-500">${m.percentage || ''}</span>
        </div>
        <p class="text-sm text-slate-400">${m.rationale || ''}</p>
        <p class="text-xs text-slate-500 mt-1">${m.quarter || ''} · ${fmtMillions(m.amountUsd)}</p>
      </div>
    </div>
  `).join('');
}

function renderCryptoWhalesList(moves = []) {
  const el = document.getElementById('crypto-whales-list');
  if (!moves.length) { el.innerHTML = '<p class="text-slate-500 text-sm text-center py-4">Sin datos</p>'; return; }

  el.innerHTML = moves.map(m => `
    <div class="flex items-center gap-3 p-3 rounded-lg bg-slate-700/20 border border-slate-700/40">
      <span class="text-xl">${m.action === 'BUY' ? '🟢' : m.action === 'SELL' ? '🔴' : '🟡'}</span>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-0.5 flex-wrap">
          <span class="font-bold text-white">${m.asset}</span>
          <span class="badge ${m.action === 'BUY' ? 'signal-buy' : m.action === 'SELL' ? 'signal-sell' : 'signal-hold'} text-xs">${m.action === 'BUY' ? 'ENTRADA' : m.action === 'SELL' ? 'SALIDA' : 'NEUTRAL'}</span>
          <span class="text-xs font-semibold text-white">${fmtMillions(m.amountUsd)}</span>
        </div>
        <p class="text-xs text-slate-400 truncate">${m.detail || ''}</p>
      </div>
    </div>
  `).join('');
}

function renderFearGreedBadge(fg = {}) {
  const v = fg.value ?? 50;
  const el = document.getElementById('fg-value-badge');
  const lb = document.getElementById('fg-label-badge');
  if (el) { el.textContent = v; el.className = `font-bold text-2xl ${v < 35 ? 'text-red-400' : v < 55 ? 'text-yellow-400' : 'text-green-400'}`; }
  if (lb) lb.textContent = fg.label ?? '';
}

// ── Portfolio ─────────────────────────────────────────────────────────────────

function renderPortfolio(data) {
  if (!data) return;
  const { holdings, summary } = data;

  // KPIs
  setText('p-invested', `$${formatNum(summary.totalInvested, 2)}`);
  setText('p-value',    `$${formatNum(summary.totalValue, 2)}`);
  const pnlEl  = document.getElementById('p-pnl');
  const pctEl  = document.getElementById('p-pnl-pct');
  if (pnlEl) { pnlEl.textContent = `${summary.totalPnl >= 0 ? '+' : ''}$${formatNum(Math.abs(summary.totalPnl), 2)}`; pnlEl.className = `text-2xl font-bold ${summary.totalPnl >= 0 ? 'up' : 'down'}`; }
  if (pctEl) { pctEl.textContent = `${summary.totalPnlPct >= 0 ? '+' : ''}${summary.totalPnlPct.toFixed(2)}%`; pctEl.className = `text-2xl font-bold ${summary.totalPnlPct >= 0 ? 'up' : 'down'}`; }

  // Tabla
  const tbody = document.getElementById('portfolio-table');
  if (!holdings?.length) { tbody.innerHTML = noDataRow(7, 'No tenés posiciones aún. Agregá tu primera posición.'); return; }

  tbody.innerHTML = holdings.map(h => `
    <tr class="hover:bg-slate-700/30 transition-colors">
      <td class="px-4 py-3">
        <div class="font-bold text-white">${h.symbol}</div>
        <div class="text-xs text-slate-400">${h.name} · <span class="uppercase">${typeLabel(h.type)}</span></div>
      </td>
      <td class="px-4 py-3 text-right text-slate-200">${h.amount}</td>
      <td class="px-4 py-3 text-right font-mono text-slate-300">${fmtPrice(h.avg_price, h.type)}</td>
      <td class="px-4 py-3 text-right font-mono hidden sm:table-cell text-slate-200">${fmtPrice(h.currentPrice, h.type)}</td>
      <td class="px-4 py-3 text-right font-semibold ${h.pnlAbs >= 0 ? 'up' : 'down'}">${h.pnlAbs >= 0 ? '+' : ''}$${formatNum(Math.abs(h.pnlAbs), 2)}</td>
      <td class="px-4 py-3 text-right hidden md:table-cell font-semibold ${h.pnlPct >= 0 ? 'up' : 'down'}">${h.pnlPct >= 0 ? '+' : ''}${h.pnlPct.toFixed(2)}%</td>
      <td class="px-4 py-3 text-center">
        <button onclick="deletePosition(${h.id})" class="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded hover:bg-red-500/10 transition-colors">✕</button>
      </td>
    </tr>
  `).join('');
}

// ── Modal agregar posición ────────────────────────────────────────────────────

function openAddModal()  { document.getElementById('add-modal').classList.remove('hidden'); }
function closeAddModal() { document.getElementById('add-modal').classList.add('hidden'); }

async function submitAddPosition() {
  const body = {
    symbol:    document.getElementById('f-symbol').value.trim().toUpperCase(),
    type:      document.getElementById('f-type').value,
    name:      document.getElementById('f-name').value.trim(),
    amount:    parseFloat(document.getElementById('f-amount').value),
    avg_price: parseFloat(document.getElementById('f-avgprice').value),
    currency:  document.getElementById('f-currency').value,
  };

  if (!body.symbol || !body.name || isNaN(body.amount) || isNaN(body.avg_price)) {
    alert('Por favor completá todos los campos requeridos.');
    return;
  }

  try {
    const res = await fetch('/api/portfolio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    closeAddModal();
    await loadPortfolio();
    // Limpiar formulario
    ['f-symbol', 'f-name', 'f-amount', 'f-avgprice'].forEach(id => document.getElementById(id).value = '');
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function deletePosition(id) {
  if (!confirm('¿Eliminar esta posición del portfolio?')) return;
  try {
    const res = await fetch(`/api/portfolio/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error al eliminar');
    await loadPortfolio();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// ── Navegación por tabs ────────────────────────────────────────────────────────

function switchTab(tab) {
  activeTab = tab;

  // Escritorio
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.className = `tab-btn px-4 py-2 transition-colors ${b.id === `tab-${tab}` ? 'tab-active' : 'tab-inactive'}`;
  });
  // Móvil
  document.querySelectorAll('.mob-tab-btn').forEach(b => {
    b.className = `mob-tab-btn whitespace-nowrap px-3 py-1.5 rounded-full transition-colors ${
      b.id === `mob-tab-${tab}` ? 'bg-blue-600/20 text-blue-400' : 'text-slate-400'
    }`;
  });
  // Panels
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('hidden', p.id !== `panel-${tab}`);
  });

  // Lazy-load de cada tab la primera vez que se abre
  if (tab === 'portfolio')  loadPortfolio();
  if (tab === 'arbitrage')  loadArbitrage();
  if (tab === 'sentiment')  loadSentiment();
}

// ── Helpers UI ─────────────────────────────────────────────────────────────────

function setLoading(loading) {
  isLoading = loading;
  const btn   = document.getElementById('refresh-btn');
  const icon  = document.getElementById('refresh-icon');
  const label = document.getElementById('refresh-label');
  if (!btn) return;
  btn.disabled   = loading;
  label.textContent = loading ? 'Actualizando...' : 'Actualizar';
  icon.className = `w-4 h-4 ${loading ? 'animate-spin' : ''}`;
}

function updateTimestamp(iso) {
  const el = document.getElementById('last-updated');
  if (!el) return;
  const d  = new Date(iso);
  el.textContent = `Actualizado: ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

function showError(msg) {
  const banner = document.getElementById('error-banner');
  const text   = document.getElementById('error-text');
  if (banner) banner.classList.remove('hidden');
  if (text)   text.textContent = msg;
}

function hideError() {
  document.getElementById('error-banner')?.classList.add('hidden');
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function noDataRow(cols, msg = 'Sin datos disponibles') {
  return `<tr><td colspan="${cols}" class="px-4 py-8 text-center text-slate-500 text-sm">${msg}</td></tr>`;
}

// ── Formateo de números ────────────────────────────────────────────────────────

function formatNum(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatLargeNum(n) {
  if (!n) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3)  return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtMillions(n) {
  if (!n) return '—';
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3)  return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function fmt24h(n) {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtPrice(price, type) {
  if (!price) return '—';
  const isArg = type === 'argentina' || type === 'cedear';
  if (isArg) return `$${formatNum(price, 0)} ARS`;
  if (price < 0.01) return `$${price.toFixed(6)}`;
  if (price < 1)    return `$${price.toFixed(4)}`;
  return `$${formatNum(price, 2)}`;
}

function typeLabel(type) {
  const map = { crypto: 'Crypto', us_stock: 'US', argentina: 'ARG', cedear: 'CEDEAR' };
  return map[type] ?? type;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MÓDULO: ARBITRAJE
// ═══════════════════════════════════════════════════════════════════════════════

let arbitrageLoaded = false;

async function loadArbitrage() {
  if (arbitrageLoaded) return; // ya cargado en esta sesión
  try {
    const res  = await fetch('/api/tools/arbitrage');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderArbitrageCrypto(data.crypto ?? []);
    renderArbitrageMep(data.mep ?? []);
    arbitrageLoaded = true;
  } catch (err) {
    document.getElementById('arbitrage-crypto-list').innerHTML =
      `<p class="text-red-400 text-sm p-4">Error al cargar: ${err.message}</p>`;
    console.error('[Arbitrage]', err);
  }
}

function renderArbitrageCrypto(opps = []) {
  const el = document.getElementById('arbitrage-crypto-list');
  if (!opps.length) {
    el.innerHTML = `<div class="text-center py-8 text-slate-500">
      <div class="text-3xl mb-2">✅</div>
      <p class="font-medium">Sin oportunidades de arbitraje en este momento</p>
      <p class="text-xs mt-1">Los precios están alineados entre exchanges (spread neto < 0.3%)</p>
    </div>`;
    return;
  }

  el.innerHTML = opps.map(op => {
    const profitColor = op.netProfitPct > 1.5 ? 'text-green-400' : op.netProfitPct > 0.5 ? 'text-yellow-400' : 'text-slate-300';
    const urgency     = op.netProfitPct > 1.5 ? 'border-green-500/40 bg-green-500/5' : 'border-slate-600/50 bg-slate-700/20';
    return `
    <div class="rounded-xl border ${urgency} p-4 flex items-center justify-between gap-4 flex-wrap">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center font-bold text-blue-300 text-sm">${op.coin}</div>
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-semibold text-white">Comprá en <span class="text-blue-400">${op.buyExchange}</span></span>
            <span class="text-slate-500">→</span>
            <span class="font-semibold text-white">Vendé en <span class="text-purple-400">${op.sellExchange}</span></span>
            ${op.isViable ? '<span class="badge bg-green-500/10 border-green-500/30 text-green-300">VIABLE</span>' : ''}
          </div>
          <div class="text-xs text-slate-400 mt-0.5">
            Compra: <span class="text-slate-200">$${formatNum(op.buyPrice, 0)}</span> &nbsp;|&nbsp;
            Venta: <span class="text-slate-200">$${formatNum(op.sellPrice, 0)}</span> &nbsp;|&nbsp;
            Spread bruto: <span class="text-slate-200">${op.grossSpreadPct?.toFixed(2)}%</span> &nbsp;|&nbsp;
            Comisiones est.: <span class="text-slate-400">${op.estimatedFeePct}%</span>
          </div>
        </div>
      </div>
      <div class="text-right">
        <div class="text-2xl font-bold ${profitColor}">+${op.netProfitPct?.toFixed(2)}%</div>
        <div class="text-xs text-slate-400">neto estimado</div>
        ${op.profitArs ? `<div class="text-xs text-green-400 mt-0.5">≈ $${formatNum(op.profitArs, 0)} ARS por $${formatNum(op.volumeArs/1000, 0)}K</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function renderArbitrageMep(opps = []) {
  const el = document.getElementById('arbitrage-mep-list');
  if (!opps.length) {
    el.innerHTML = `<p class="text-slate-500 text-sm text-center py-6">Sin diferencias significativas entre proveedores MEP</p>`;
    return;
  }
  el.innerHTML = opps.map(op => `
    <div class="rounded-xl border border-slate-600/50 bg-slate-700/20 p-4 flex items-center justify-between gap-4">
      <div>
        <div class="font-semibold text-white">${op.coin ?? 'MEP'} — ${op.buyExchange} → ${op.sellExchange}</div>
        <div class="text-xs text-slate-400 mt-0.5">Compra $${formatNum(op.buyPrice, 0)} | Venta $${formatNum(op.sellPrice, 0)}</div>
      </div>
      <div class="text-right">
        <div class="font-bold ${op.netProfitPct > 0 ? 'text-green-400' : 'text-slate-400'}">+${op.netProfitPct?.toFixed(2)}%</div>
        <div class="text-xs text-slate-500">neto</div>
      </div>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MÓDULO: SENTIMIENTO
// ═══════════════════════════════════════════════════════════════════════════════

let sentimentLoaded = false;

async function loadSentiment() {
  sentimentLoaded = false; // permitir recarga manual
  document.getElementById('sent-overall-score').textContent = '…';
  try {
    const res  = await fetch('/api/tools/sentiment');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderSentiment(data);
    sentimentLoaded = true;
  } catch (err) {
    console.error('[Sentiment]', err);
    document.getElementById('sent-overall-label').textContent = 'Error al cargar el análisis';
  }
}

function renderSentiment(data) {
  // KPIs
  const score     = data.overall?.score ?? 0;
  const scoreEl   = document.getElementById('sent-overall-score');
  const labelEl   = document.getElementById('sent-overall-label');
  const postsEl   = document.getElementById('sent-overall-posts');
  const tsEl      = document.getElementById('sent-timestamp');

  if (scoreEl) {
    scoreEl.textContent = score.toFixed(2);
    scoreEl.className   = `text-4xl font-bold mb-1 ${score > 0.2 ? 'up' : score < -0.2 ? 'down' : 'text-yellow-400'}`;
  }
  if (labelEl) labelEl.textContent = data.overall?.label ?? '—';
  if (postsEl) postsEl.textContent = data.overall?.postsAnalyzed ? `${data.overall.postsAnalyzed} posts analizados` : '';
  if (tsEl)    tsEl.textContent    = data.lastUpdated ? new Date(data.lastUpdated).toLocaleTimeString('es-AR') : '—';
  if (data.isMock) {
    const mockBadge = document.createElement('span');
    mockBadge.className   = 'badge bg-amber-500/10 border-amber-500/30 text-amber-300 text-xs mt-2 mx-auto';
    mockBadge.textContent = 'DATOS DEMO';
    tsEl?.after(mockBadge);
  }

  // Tendencias
  const trendEl = document.getElementById('sent-trending');
  if (trendEl) {
    trendEl.innerHTML = (data.trending ?? []).map(t =>
      `<span class="px-3 py-1 rounded-full bg-blue-500/15 border border-blue-500/25 text-blue-300 text-xs font-bold">${t}</span>`
    ).join('') || '<span class="text-slate-500 text-sm">Sin tendencias detectadas</span>';
  }

  // Por subreddit
  const subEl = document.getElementById('sent-subreddits');
  if (subEl) {
    subEl.innerHTML = (data.bySubreddit ?? []).map(s => {
      const color = s.score > 0.2 ? 'green' : s.score < -0.2 ? 'red' : 'yellow';
      const bar   = Math.round((s.score + 1) / 2 * 100);
      return `
      <div class="rounded-xl border border-slate-700/50 bg-slate-700/20 p-4">
        <div class="flex items-center justify-between mb-2">
          <span class="font-semibold text-white text-sm">r/${s.subreddit}</span>
          <span class="font-bold ${color === 'green' ? 'up' : color === 'red' ? 'down' : 'text-yellow-400'}">${s.score > 0 ? '+' : ''}${s.score.toFixed(2)}</span>
        </div>
        <div class="h-1.5 bg-slate-700 rounded-full mb-2">
          <div class="h-full rounded-full ${color === 'green' ? 'bg-green-500' : color === 'red' ? 'bg-red-500' : 'bg-yellow-500'}" style="width:${bar}%"></div>
        </div>
        <p class="text-xs text-slate-400 line-clamp-2">${s.topPost}</p>
        <span class="badge ${color === 'green' ? 'signal-buy' : color === 'red' ? 'signal-sell' : 'signal-hold'} mt-2">${s.label}</span>
      </div>`;
    }).join('') || '<p class="text-slate-500 text-sm col-span-2 text-center py-4">Sin datos de subreddits</p>';
  }

  // Por activo
  const tbody = document.getElementById('sent-assets-table');
  if (tbody) {
    const assets = data.byAsset ?? [];
    if (!assets.length) { tbody.innerHTML = noDataRow(4, 'Sin menciones detectadas'); return; }
    tbody.innerHTML = assets.map(a => {
      const scoreClass = a.score > 0.2 ? 'up' : a.score < -0.2 ? 'down' : 'text-yellow-400';
      const badgeClass = a.score > 0.2 ? 'signal-buy' : a.score < -0.2 ? 'signal-sell' : 'signal-hold';
      return `<tr class="hover:bg-slate-700/30 transition-colors">
        <td class="px-4 py-3 font-bold text-white">${a.symbol}</td>
        <td class="px-4 py-3 text-center text-slate-300">${a.mentions}</td>
        <td class="px-4 py-3 text-center font-mono ${scoreClass}">${a.score > 0 ? '+' : ''}${a.score.toFixed(2)}</td>
        <td class="px-4 py-3 text-center"><span class="badge ${badgeClass}">${a.label}</span></td>
      </tr>`;
    }).join('');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MÓDULO: BACKTESTING
// ═══════════════════════════════════════════════════════════════════════════════

async function runBacktest() {
  const assetRaw = document.getElementById('bt-asset')?.value ?? '';
  const [symbol, name, type, priceStr, ch24hStr] = assetRaw.split('|');
  const days     = document.getElementById('bt-days')?.value   ?? '90';
  const capital  = document.getElementById('bt-capital')?.value ?? '10000';

  const btn = document.getElementById('bt-btn-label');
  if (btn) btn.textContent = '⏳ Simulando...';
  document.getElementById('bt-empty')?.classList.add('hidden');
  document.getElementById('bt-results')?.classList.add('hidden');

  try {
    const res = await fetch('/api/tools/backtest', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        symbol, name, type,
        price:      parseFloat(priceStr),
        change24h:  parseFloat(ch24hStr),
        days:       parseInt(days),
        initialCapital: parseFloat(capital),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderBacktestResults(data);
  } catch (err) {
    console.error('[Backtest]', err);
    alert(`Error al correr la simulación: ${err.message}`);
    document.getElementById('bt-empty')?.classList.remove('hidden');
  } finally {
    if (btn) btn.textContent = '▶ Simular';
  }
}

function renderBacktestResults(d) {
  document.getElementById('bt-results')?.classList.remove('hidden');
  document.getElementById('bt-empty')?.classList.add('hidden');

  const retEl  = document.getElementById('bt-return');
  const alphaEl = document.getElementById('bt-alpha');
  if (retEl) {
    retEl.textContent = `${d.totalReturn >= 0 ? '+' : ''}${d.totalReturn?.toFixed(1)}%`;
    retEl.className   = `text-2xl font-bold ${d.totalReturn >= 0 ? 'up' : 'down'}`;
  }
  setText('bt-bh',      `${d.buyAndHoldReturn >= 0 ? '+' : ''}${d.buyAndHoldReturn?.toFixed(1)}%`);
  setText('bt-dd',      `${d.maxDrawdown?.toFixed(1)}%`);
  const sharpeEl = document.getElementById('bt-sharpe');
  if (sharpeEl) {
    sharpeEl.textContent = d.sharpeRatio?.toFixed(2) ?? '—';
    sharpeEl.className   = `text-2xl font-bold ${d.sharpeRatio > 1 ? 'up' : d.sharpeRatio < 0 ? 'down' : 'text-yellow-400'}`;
  }
  setText('bt-winrate', `${d.winRate?.toFixed(1)}%`);
  setText('bt-trades',  d.totalTrades ?? '—');
  if (alphaEl) {
    const alpha = d.strategyVsBuyHold ?? 0;
    alphaEl.textContent = `${alpha >= 0 ? '+' : ''}${alpha.toFixed(1)}%`;
    alphaEl.className   = `text-xl font-bold ${alpha >= 0 ? 'up' : 'down'}`;
  }

  // Tabla de operaciones
  const tbody = document.getElementById('bt-trades-table');
  if (tbody && d.trades?.length) {
    tbody.innerHTML = d.trades.map(t => `
      <tr class="hover:bg-slate-700/30 transition-colors">
        <td class="px-4 py-3 text-slate-400">Día ${t.day}</td>
        <td class="px-4 py-3 text-center">
          <span class="badge ${t.action === 'BUY' ? 'signal-buy' : 'signal-sell'}">${t.action === 'BUY' ? 'COMPRA' : 'VENTA'}</span>
        </td>
        <td class="px-4 py-3 text-right font-mono text-slate-200">$${formatNum(t.price, 2)}</td>
        <td class="px-4 py-3 text-right font-semibold text-white">$${formatNum(t.capital, 2)}</td>
      </tr>
    `).join('');
  } else if (tbody) {
    tbody.innerHTML = noDataRow(4, 'Sin operaciones en este período');
  }
}
