/**
 * cryptoService.js — Integración con CoinGecko (gratuito, sin API key)
 * y Fear & Greed Index de alternative.me
 *
 * Estrategia de caché: almacena resultados en memoria por CACHE_TTL minutos
 * para respetar los límites de rate del tier gratuito de CoinGecko (30 req/min)
 */

import axios from 'axios';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const FEAR_GREED_URL = 'https://api.alternative.me/fng/?limit=1';
const CACHE_TTL_MS   = (parseInt(process.env.CACHE_TTL_MINUTES) || 5) * 60 * 1000;

// Caché en memoria simple { data, timestamp }
let cache = { coins: null, fearGreed: null };

/** Monedas a rastrear por defecto */
const DEFAULT_COINS = [
  'bitcoin', 'ethereum', 'binancecoin', 'solana', 'ripple',
  'cardano', 'avalanche-2', 'chainlink', 'polkadot', 'uniswap'
];

/**
 * Obtiene precios, volumen 24h y variación de las top criptomonedas.
 * @returns {Promise<Array>} Array de objetos con datos de cada moneda
 */
export async function getCryptoPrices() {
  // Retornar caché si está vigente
  if (cache.coins && Date.now() - cache.coins.timestamp < CACHE_TTL_MS) {
    return cache.coins.data;
  }

  try {
    const response = await axios.get(`${COINGECKO_BASE}/coins/markets`, {
      params: {
        vs_currency:          'usd',
        ids:                  DEFAULT_COINS.join(','),
        order:                'market_cap_desc',
        per_page:             10,
        page:                 1,
        sparkline:            false,
        price_change_percentage: '1h,24h,7d',
      },
      timeout: 8000,
    });

    const coins = response.data.map(coin => ({
      id:             coin.id,
      symbol:         coin.symbol.toUpperCase(),
      name:           coin.name,
      price:          coin.current_price,
      marketCap:      coin.market_cap,
      volume24h:      coin.total_volume,
      change1h:       coin.price_change_percentage_1h_in_currency ?? 0,
      change24h:      coin.price_change_percentage_24h ?? 0,
      change7d:       coin.price_change_percentage_7d_in_currency ?? 0,
      image:          coin.image,
      rank:           coin.market_cap_rank,
      type:           'crypto',
    }));

    cache.coins = { data: coins, timestamp: Date.now() };
    return coins;

  } catch (error) {
    console.warn('[CryptoService] Error al consultar CoinGecko, usando mock:', error.message);
    // Si la API falla, retornar datos mock para no romper el dashboard
    return getMockCryptoData();
  }
}

/**
 * Obtiene el índice Fear & Greed del mercado cripto.
 * 0-24 = Miedo Extremo | 25-49 = Miedo | 50-74 = Codicia | 75-100 = Codicia Extrema
 * @returns {Promise<{value: number, label: string, updatedAt: string}>}
 */
export async function getFearGreedIndex() {
  if (cache.fearGreed && Date.now() - cache.fearGreed.timestamp < CACHE_TTL_MS) {
    return cache.fearGreed.data;
  }

  try {
    const response = await axios.get(FEAR_GREED_URL, { timeout: 5000 });
    const entry = response.data.data[0];

    const data = {
      value:     parseInt(entry.value),
      label:     translateFearGreedLabel(entry.value_classification),
      updatedAt: new Date(parseInt(entry.timestamp) * 1000).toISOString(),
    };

    cache.fearGreed = { data, timestamp: Date.now() };
    return data;

  } catch (error) {
    console.warn('[CryptoService] Error al obtener Fear & Greed:', error.message);
    return { value: 52, label: 'Neutral', updatedAt: new Date().toISOString() };
  }
}

/** Traduce las etiquetas del Fear & Greed Index al español */
function translateFearGreedLabel(label) {
  const map = {
    'Extreme Fear': 'Miedo Extremo',
    'Fear':         'Miedo',
    'Neutral':      'Neutral',
    'Greed':        'Codicia',
    'Extreme Greed': 'Codicia Extrema',
  };
  return map[label] || label;
}

/** Datos mock para cuando CoinGecko no está disponible */
function getMockCryptoData() {
  return [
    { id: 'bitcoin',   symbol: 'BTC', name: 'Bitcoin',   price: 67450, marketCap: 1.32e12, volume24h: 28.4e9, change1h: 0.3,  change24h: 2.1,  change7d: 5.4,  rank: 1,  type: 'crypto' },
    { id: 'ethereum',  symbol: 'ETH', name: 'Ethereum',  price: 3520,  marketCap: 4.23e11, volume24h: 15.2e9, change1h: 0.5,  change24h: 1.8,  change7d: 4.2,  rank: 2,  type: 'crypto' },
    { id: 'binancecoin', symbol: 'BNB', name: 'BNB',     price: 598,   marketCap: 8.7e10,  volume24h: 2.1e9,  change1h: -0.2, change24h: -0.5, change7d: 1.1,  rank: 3,  type: 'crypto' },
    { id: 'solana',    symbol: 'SOL', name: 'Solana',    price: 178,   marketCap: 8.2e10,  volume24h: 4.3e9,  change1h: 1.2,  change24h: 4.5,  change7d: 12.3, rank: 4,  type: 'crypto' },
    { id: 'ripple',    symbol: 'XRP', name: 'XRP',       price: 0.58,  marketCap: 3.2e10,  volume24h: 1.8e9,  change1h: 0.1,  change24h: -1.2, change7d: -3.1, rank: 5,  type: 'crypto' },
    { id: 'cardano',   symbol: 'ADA', name: 'Cardano',   price: 0.44,  marketCap: 1.56e10, volume24h: 420e6,  change1h: -0.3, change24h: -2.1, change7d: -5.2, rank: 8,  type: 'crypto' },
    { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche', price: 35.2, marketCap: 1.44e10, volume24h: 680e6, change1h: 0.8, change24h: 3.2, change7d: 8.1, rank: 9, type: 'crypto' },
    { id: 'chainlink', symbol: 'LINK', name: 'Chainlink', price: 14.8, marketCap: 8.7e9, volume24h: 380e6,  change1h: 0.4,  change24h: 1.5,  change7d: 6.3,  rank: 12, type: 'crypto' },
  ];
}
