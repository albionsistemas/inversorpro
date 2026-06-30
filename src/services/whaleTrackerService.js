/**
 * whaleTrackerService.js — Seguimiento de inversores institucionales y ballenas cripto
 *
 * Fuentes de datos (arquitectura lista para conectar):
 *   - SEC EDGAR API: 13F filings (declaraciones trimestrales de fondos >$100M)
 *     https://efts.sec.gov/LATEST/search-index?forms=13F-HR
 *   - Whale Alert API: transacciones cripto grandes en tiempo real
 *     https://docs.whale-alert.io
 *   - Datos mock educativos basados en posiciones públicas reales
 *
 * Superinversores rastreados:
 *   - Warren Buffett (Berkshire Hathaway)
 *   - Ray Dalio (Bridgewater Associates)
 *   - Cathie Wood (ARK Invest)
 *   - Michael Burry (Scion Asset Management)
 *   - Stanley Druckenmiller
 */

const CACHE_TTL_MS = (parseInt(process.env.CACHE_TTL_MINUTES) || 5) * 60 * 1000;
let cache = { activities: null };

/**
 * Retorna los últimos movimientos de inversores institucionales y ballenas cripto.
 * @returns {Promise<{institutional: Array, cryptoWhales: Array, sentiment: Object}>}
 */
export async function getWhaleActivities() {
  if (cache.activities && Date.now() - cache.activities.timestamp < CACHE_TTL_MS) {
    return cache.activities.data;
  }

  // En producción: fetch a SEC EDGAR + Whale Alert APIs
  // Por ahora: datos mock con posiciones públicas conocidas
  const data = {
    institutional: getInstitutionalMoves(),
    cryptoWhales:  getCryptoWhaleMoves(),
    sentiment:     calculateOverallSentiment(),
    lastUpdated:   new Date().toISOString(),
    dataSource:    'demo', // cambiar a 'live' cuando se conecten APIs reales
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

function getCryptoWhaleMoves() {
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
