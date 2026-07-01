/**
 * whaleTrackerService.js — Seguimiento de inversores institucionales y ballenas cripto
 *
 * Fuentes de datos:
 *   - Whale Alert API: transacciones cripto grandes en tiempo real (última hora)
 *     https://docs.whale-alert.io — requiere WHALE_ALERT_API_KEY en .env, si no
 *     está configurada cae a datos mock.
 *   - SEC EDGAR API: 13F-HR (declaraciones trimestrales de fondos >$100M)
 *     https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets —
 *     sin API key, requiere solo un User-Agent identificable (SEC_EDGAR_USER_AGENT).
 *     Compara el último filing contra el anterior para inferir BUY/SELL. Si un
 *     gestor falla o SEC EDGAR no responde, cae a datos mock para ese gestor.
 *
 * Superinversores rastreados (CIK de SEC EDGAR):
 *   - Warren Buffett (Berkshire Hathaway)     — CIK 1067983
 *   - Ray Dalio (Bridgewater Associates)      — CIK 1350694
 *   - Cathie Wood (ARK Invest)                — CIK 1697748
 *   - Michael Burry (Scion Asset Management)  — CIK 1649339
 *   - Stanley Druckenmiller (Duquesne Family Office) — CIK 1536411
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { reportStatus } from './statusTracker.js';

const CACHE_TTL_MS = (parseInt(process.env.CACHE_TTL_MINUTES) || 5) * 60 * 1000;
const WHALE_ALERT_MIN_VALUE = parseInt(process.env.WHALE_ALERT_MIN_VALUE) || 500000;
let cache = { activities: null };

/**
 * Retorna los últimos movimientos de inversores institucionales y ballenas cripto.
 * @returns {Promise<{institutional: Array, cryptoWhales: Array, sentiment: Object}>}
 */
export async function getWhaleActivities() {
  if (cache.activities && Date.now() - cache.activities.timestamp < CACHE_TTL_MS) {
    return cache.activities.data;
  }

  const data = {
    institutional: await getInstitutionalMoves(),
    cryptoWhales:  await getCryptoWhaleMoves(),
    sentiment:     calculateOverallSentiment(),
    lastUpdated:   new Date().toISOString(),
  };

  cache.activities = { data, timestamp: Date.now() };
  return data;
}

/**
 * Calcula el sentimiento por activo, agregando todos los movimientos.
 * Retorna un mapa: symbol → score (-1 a 1)
 * +1 = acumulación fuerte | 0 = neutral | -1 = distribución fuerte
 */
export function getAssetSentimentMap(whaleData) {
  const sentimentMap = {};

  const allMoves = [
    ...whaleData.institutional.map(m => ({ symbol: m.asset, action: m.action, weight: 1.0 })),
    ...whaleData.cryptoWhales.map(m => ({ symbol: m.asset, action: m.action, weight: 0.6 })),
  ];

  allMoves.forEach(move => {
    if (!sentimentMap[move.symbol]) sentimentMap[move.symbol] = { total: 0, count: 0 };
    const score = move.action === 'BUY' ? 1 : move.action === 'SELL' ? -1 : 0;
    sentimentMap[move.symbol].total += score * move.weight;
    sentimentMap[move.symbol].count += 1;
  });

  // Normalizar a rango -1 a 1
  const normalized = {};
  for (const [symbol, data] of Object.entries(sentimentMap)) {
    normalized[symbol] = parseFloat((data.total / Math.max(data.count, 1)).toFixed(2));
  }

  return normalized;
}

// --- Movimientos institucionales reales vía SEC EDGAR (13F-HR) ---

// SEC exige un User-Agent identificable en todos los requests (política de acceso justo)
const SEC_EDGAR_USER_AGENT = process.env.SEC_EDGAR_USER_AGENT || 'InversorPro Dashboard albionsistemas@gmail.com';
const SEC_HEADERS = { 'User-Agent': SEC_EDGAR_USER_AGENT, 'Accept-Encoding': 'gzip, deflate' };

// Los 13F son trimestrales: no hace falta refrescar tan seguido como el resto de las APIs
const INSTITUTIONAL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let institutionalCache = { data: null, timestamp: 0 };

const TRACKED_MANAGERS = [
  { investor: 'Warren Buffett (Berkshire Hathaway)',    cik: '0001067983' },
  { investor: 'Ray Dalio (Bridgewater Associates)',     cik: '0001350694' },
  { investor: 'Cathie Wood (ARK Invest)',               cik: '0001697748' },
  { investor: 'Michael Burry (Scion Asset Management)', cik: '0001649339' },
  { investor: 'Stanley Druckenmiller (Duquesne)',       cik: '0001536411' },
];

// CUSIP → ticker de las posiciones que también seguimos en US Stocks.
// El 13F no incluye el ticker, solo CUSIP + nombre del emisor; sin match acá
// se muestra el nombre del emisor tal cual lo reporta el filing.
const CUSIP_TICKERS = {
  '037833100': 'AAPL',
  '594918104': 'MSFT',
  '02079K305': 'GOOGL',
  '023135106': 'AMZN',
  '67066G104': 'NVDA',
  '88160R101': 'TSLA',
  '30303M102': 'META',
  '084670702': 'BRK-B',
  '46625H100': 'JPM',
  '92826C839': 'V',
};

/**
 * Movimientos institucionales: compara el último 13F-HR de cada gestor contra
 * el anterior para inferir BUY/SELL por variación de valor de posición.
 * Si SEC EDGAR falla para todos los gestores, cae a datos mock.
 */
async function getInstitutionalMoves() {
  if (institutionalCache.data && Date.now() - institutionalCache.timestamp < INSTITUTIONAL_CACHE_TTL_MS) {
    return institutionalCache.data;
  }

  const results = await Promise.allSettled(TRACKED_MANAGERS.map(fetchManagerMoves));
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.warn(`[WhaleTrackerService] SEC EDGAR (${TRACKED_MANAGERS[i].investor}):`, r.reason?.message);
    }
  });

  const moves = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);

  if (!moves.length) {
    reportStatus('whales_institutional', 'Whale Tracker (Institucional)', false,
      'SEC EDGAR no respondió para ningún gestor — usando datos demo');
    return getMockInstitutionalMoves();
  }

  moves.sort((a, b) => b.amountUsd - a.amountUsd);
  reportStatus('whales_institutional', 'Whale Tracker (Institucional)', true,
    `SEC EDGAR 13F-HR (${results.filter(r => r.status === 'fulfilled').length}/${TRACKED_MANAGERS.length} gestores)`);

  institutionalCache = { data: moves, timestamp: Date.now() };
  return moves;
}

/** Obtiene y compara los dos últimos 13F-HR de un gestor puntual. */
async function fetchManagerMoves({ investor, cik }) {
  const submissions = await axios.get(`https://data.sec.gov/submissions/CIK${cik}.json`, {
    headers: SEC_HEADERS, timeout: 10000,
  });

  const recent = submissions.data?.filings?.recent;
  if (!recent) throw new Error(`Sin filings para CIK ${cik}`);

  const filings = recent.form
    .map((form, i) => ({ form, accessionNumber: recent.accessionNumber[i], reportDate: recent.reportDate[i] }))
    .filter(f => f.form === '13F-HR')
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate));

  // Únicos por trimestre (por si hay más de un filing para el mismo reportDate)
  const byQuarter = [];
  for (const f of filings) {
    if (!byQuarter.some(q => q.reportDate === f.reportDate)) byQuarter.push(f);
    if (byQuarter.length === 2) break;
  }
  if (byQuarter.length < 2) throw new Error(`No hay suficientes trimestres 13F-HR para ${investor}`);

  const [current, previous] = byQuarter;
  const cikNum = String(parseInt(cik, 10));
  const [curHoldings, prevHoldings] = await Promise.all([
    fetchHoldings(cikNum, current.accessionNumber),
    fetchHoldings(cikNum, previous.accessionNumber),
  ]);

  return diffHoldings(curHoldings, prevHoldings, investor, quarterLabel(current.reportDate))
    .sort((a, b) => b.amountUsd - a.amountUsd)
    .slice(0, 2);
}

/** Descarga y parsea la information table (holdings) de un filing 13F-HR puntual. */
async function fetchHoldings(cikNum, accessionNumber) {
  const accNoDashes = accessionNumber.replace(/-/g, '');
  const dir = await axios.get(`https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDashes}/index.json`, {
    headers: SEC_HEADERS, timeout: 10000,
  });

  const items = dir.data?.directory?.item ?? [];
  const infoTableFile = items.find(it =>
    it.name.toLowerCase().endsWith('.xml') && it.name.toLowerCase() !== 'primary_doc.xml'
  );
  if (!infoTableFile) throw new Error(`No se encontró information table en ${accessionNumber}`);

  const xmlRes = await axios.get(
    `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDashes}/${infoTableFile.name}`,
    { headers: SEC_HEADERS, timeout: 10000 }
  );

  const $ = cheerio.load(xmlRes.data, { xmlMode: true });
  const holdings = {}; // cusip -> { value, nameOfIssuer }

  // Los filers pueden usar prefijo de namespace (ns1:infoTable); comparamos solo el nombre local
  const localName = (el) => String(el.tagName || el.name || '').split(':').pop().toLowerCase();
  const firstText = (scope, name) => $(scope).find('*').filter((_, e) => localName(e) === name).first().text().trim();

  $.root().find('*').filter((_, el) => localName(el) === 'infotable').each((_, el) => {
    const cusip = firstText(el, 'cusip');
    if (!cusip) return;
    const value = parseFloat(firstText(el, 'value')) || 0;
    if (!holdings[cusip]) holdings[cusip] = { value: 0, nameOfIssuer: firstText(el, 'nameofissuer') };
    holdings[cusip].value += value;
  });

  return holdings;
}

/** Compara holdings de dos trimestres y arma movimientos BUY/SELL por variación >5%. */
function diffHoldings(current, previous, investor, quarter) {
  const cusips = new Set([...Object.keys(current), ...Object.keys(previous)]);
  const moves = [];

  for (const cusip of cusips) {
    const cur  = current[cusip]?.value  ?? 0;
    const prev = previous[cusip]?.value ?? 0;
    const name = current[cusip]?.nameOfIssuer || previous[cusip]?.nameOfIssuer || cusip;
    const asset = CUSIP_TICKERS[cusip] ?? name;

    let action, percentage, amountUsd, rationale;
    if (prev === 0 && cur > 0) {
      action = 'BUY'; percentage = 'Nueva posición'; amountUsd = cur;
      rationale = 'Nueva posición según 13F-HR';
    } else if (cur === 0 && prev > 0) {
      action = 'SELL'; percentage = 'Cierre total de posición'; amountUsd = prev;
      rationale = 'Cierre total de la posición según 13F-HR';
    } else {
      const pct = (cur - prev) / prev;
      if (pct > 0.05) {
        action = 'BUY'; percentage = `+${(pct * 100).toFixed(0)}% de posición`;
        rationale = 'Aumento de posición según 13F-HR';
      } else if (pct < -0.05) {
        action = 'SELL'; percentage = `${(pct * 100).toFixed(0)}% de posición`;
        rationale = 'Reducción de posición según 13F-HR';
      } else {
        continue; // sin cambio significativo
      }
      amountUsd = Math.abs(cur - prev);
    }

    moves.push({ investor, asset, action, amountUsd, percentage, quarter, rationale, type: 'us_stock' });
  }

  return moves;
}

function quarterLabel(reportDate) {
  const [year, month] = reportDate.split('-').map(Number);
  return `Q${Math.ceil(month / 3)} ${year}`;
}

// --- Datos mock de respaldo (si SEC EDGAR no responde) ---

function getMockInstitutionalMoves() {
  return [
    {
      investor:   'Warren Buffett (Berkshire)',
      asset:      'AAPL',
      action:     'SELL',
      amountUsd:  1.8e9,
      percentage: '-13% de posición',
      quarter:    'Q1 2024',
      rationale:  'Reducción parcial tomando ganancias; mantiene el 40% de cartera',
      type:       'us_stock',
    },
    {
      investor:   'Cathie Wood (ARK Invest)',
      asset:      'TSLA',
      action:     'BUY',
      amountUsd:  120e6,
      percentage: '+8% de posición',
      quarter:    'Q2 2024',
      rationale:  'Acumulación ante caída de precio; ARK ve valor a largo plazo en robotaxi',
      type:       'us_stock',
    },
    {
      investor:   'Cathie Wood (ARK Invest)',
      asset:      'NVDA',
      action:     'SELL',
      amountUsd:  890e6,
      percentage: '-30% de posición',
      quarter:    'Q1 2024',
      rationale:  'Toma de ganancias tras rally del 200%; rota hacia MSFT y AMZN',
      type:       'us_stock',
    },
    {
      investor:   'Ray Dalio (Bridgewater)',
      asset:      'GOOGL',
      action:     'BUY',
      amountUsd:  450e6,
      percentage: '+22% de posición',
      quarter:    'Q2 2024',
      rationale:  'Diversificación en IA; Alphabet cotiza barato vs peers de IA',
      type:       'us_stock',
    },
    {
      investor:   'Michael Burry (Scion)',
      asset:      'AMZN',
      action:     'BUY',
      amountUsd:  73e6,
      percentage: 'Nueva posición',
      quarter:    'Q1 2024',
      rationale:  'AWS como proxy de crecimiento en cloud; cloud computing subestimado',
      type:       'us_stock',
    },
    {
      investor:   'Stanley Druckenmiller',
      asset:      'MSFT',
      action:     'BUY',
      amountUsd:  620e6,
      percentage: '+15% de posición',
      quarter:    'Q2 2024',
      rationale:  'Mayor convicción en integración de Copilot AI en el ecosistema corporativo',
      type:       'us_stock',
    },
    {
      investor:   'Michael Burry (Scion)',
      asset:      'META',
      action:     'SELL',
      amountUsd:  41e6,
      percentage: 'Cierre total de posición',
      quarter:    'Q2 2024',
      rationale:  'Valuación estirada; reserva liquidez para oportunidades en Asia',
      type:       'us_stock',
    },
  ];
}

/**
 * Obtiene transacciones cripto grandes de la última hora vía Whale Alert.
 * Sin WHALE_ALERT_API_KEY configurada (o si la API falla), cae a datos mock.
 */
async function getCryptoWhaleMoves() {
  const apiKey = process.env.WHALE_ALERT_API_KEY;
  if (!apiKey) {
    reportStatus('whales_crypto', 'Whale Tracker (Cripto)', false,
      'Sin WHALE_ALERT_API_KEY configurada — obtenela en whale-alert.io');
    return getMockCryptoWhaleMoves();
  }

  try {
    const start = Math.floor(Date.now() / 1000) - 3600; // última hora
    const r = await axios.get('https://api.whale-alert.io/v1/transactions', {
      params:  { api_key: apiKey, min_value: WHALE_ALERT_MIN_VALUE, start, limit: 100 },
      timeout: 8000,
    });

    const moves = (r.data?.transactions ?? [])
      .map(mapWhaleAlertTransaction)
      .filter(Boolean)
      .sort((a, b) => b.amountUsd - a.amountUsd)
      .slice(0, 8);

    reportStatus('whales_crypto', 'Whale Tracker (Cripto)', true, 'Whale Alert API');
    return moves;
  } catch (e) {
    console.warn('[WhaleTrackerService] Whale Alert:', e.message);
    reportStatus('whales_crypto', 'Whale Tracker (Cripto)', false, e.message);
    return getMockCryptoWhaleMoves();
  }
}

/**
 * Traduce una transacción de Whale Alert a un movimiento con señal BUY/SELL.
 * Retiro desde exchange → acumulación (BUY). Depósito a exchange → posible venta (SELL).
 * Movimientos exchange-a-exchange o wallet-a-wallet no traen señal clara y se descartan.
 */
function mapWhaleAlertTransaction(tx) {
  const fromExchange = tx.from?.owner_type === 'exchange';
  const toExchange    = tx.to?.owner_type === 'exchange';
  const symbol        = (tx.symbol || '').toUpperCase();
  const amount        = Math.round(tx.amount).toLocaleString('en-US');

  let action, walletTag, detail;
  if (fromExchange && !toExchange) {
    action    = 'BUY';
    walletTag = tx.to?.address ?? '';
    detail    = `${amount} ${symbol} retirados de ${tx.from.owner || 'exchange'} a billetera fría (señal de acumulación)`;
  } else if (toExchange && !fromExchange) {
    action    = 'SELL';
    walletTag = tx.from?.address ?? '';
    detail    = `${amount} ${symbol} depositados en ${tx.to.owner || 'exchange'} (señal de posible venta)`;
  } else {
    return null;
  }

  return {
    investor:  `Ballena ${symbol}`,
    asset:     symbol,
    action,
    amountUsd: tx.amount_usd,
    walletTag,
    detail,
    type:      'crypto',
  };
}

function getMockCryptoWhaleMoves() {
  return [
    {
      investor:  'Wallet Ballena #1 (Bitcoin)',
      asset:     'BTC',
      action:    'BUY',
      amountUsd: 180e6,
      walletTag: '1P5ZEDWTKTFGxQjZphgWPQUpe554WKDfHQ',
      detail:    '2,671 BTC recibidos desde exchange Binance → billetera fría (señal de acumulación)',
      type:      'crypto',
    },
    {
      investor:  'Wallet Ballena #2 (Ethereum)',
      asset:     'ETH',
      action:    'BUY',
      amountUsd: 95e6,
      walletTag: '0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE',
      detail:    '27,000 ETH movidos a staking (señal de mantener largo plazo)',
      type:      'crypto',
    },
    {
      investor:  'Wallet Ballena #3 (Solana)',
      asset:     'SOL',
      action:    'SELL',
      amountUsd: 42e6,
      walletTag: 'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
      detail:    '238,000 SOL enviados a exchange Coinbase (señal de posible venta)',
      type:      'crypto',
    },
    {
      investor:  'MicroStrategy (Michael Saylor)',
      asset:     'BTC',
      action:    'BUY',
      amountUsd: 786e6,
      walletTag: 'MicroStrategy Corp.',
      detail:    'Compra de 11,931 BTC adicionales a $66,000 promedio',
      type:      'crypto',
    },
  ];
}

function calculateOverallSentiment() {
  return {
    crypto:     { score: 0.65, label: 'Acumulación moderada', bullishPercent: 75 },
    us_stocks:  { score: 0.2,  label: 'Mixto — tech selectivo', bullishPercent: 55 },
    argentina:  { score: 0.0,  label: 'Sin datos institucionales suficientes', bullishPercent: 50 },
  };
}
