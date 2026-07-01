/**
 * whaleTrackerService.js — Seguimiento de inversores institucionales y ballenas cripto
 *
 * Fuentes de datos:
 *   - Whale Alert API: transacciones cripto grandes en tiempo real (última hora)
 *     https://docs.whale-alert.io — requiere WHALE_ALERT_API_KEY en .env, si no
 *     está configurada cae a datos mock.
 *   - SEC EDGAR API: 13F filings (declaraciones trimestrales de fondos >$100M)
 *     https://efts.sec.gov/LATEST/search-index?forms=13F-HR — todavía no
 *     conectado (requiere parsear XML/XBRL de los filings), datos mock permanente.
 *
 * Superinversores rastreados (mock, basado en 13F públicos reales):
 *   - Warren Buffett (Berkshire Hathaway)
 *   - Ray Dalio (Bridgewater Associates)
 *   - Cathie Wood (ARK Invest)
 *   - Michael Burry (Scion Asset Management)
 *   - Stanley Druckenmiller
 */

import axios from 'axios';
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

  reportStatus('whales_institutional', 'Whale Tracker (Institucional)', false,
    'Mock permanente — requiere parser de SEC EDGAR 13F (declaraciones trimestrales)');

  const data = {
    institutional: getInstitutionalMoves(),
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

// --- Datos mock de movimientos institucionales ---

function getInstitutionalMoves() {
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
