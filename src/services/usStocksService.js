/**
 * usStocksService.js — Cotizaciones de acciones internacionales (mercado US)
 *
 * Fuente primaria: Yahoo Finance API no oficial (gratuita, sin key)
 * Fuente de respaldo: datos mock con precios realistas
 *
 * Lista de seguimiento: blue chips, tech y las posiciones de superinversores
 */

import axios from 'axios';

const YAHOO_QUOTE_URL = 'https://query1.finance.yahoo.com/v7/finance/quote';
const CACHE_TTL_MS    = (parseInt(process.env.CACHE_TTL_MINUTES) || 5) * 60 * 1000;

let cache = { stocks: null };

/** Watchlist de acciones US a monitorear */
const WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN', 'META', 'BRK-B', 'JPM', 'V'];

/**
 * Retorna cotizaciones actualizadas para el watchlist de acciones US.
 * @returns {Promise<Array>} Array de objetos con datos de cada acción
 */
export async function getUSStockPrices() {
  if (cache.stocks && Date.now() - cache.stocks.timestamp < CACHE_TTL_MS) {
    return cache.stocks.data;
  }

  try {
    const response = await axios.get(YAHOO_QUOTE_URL, {
      params: { symbols: WATCHLIST.join(','), lang: 'en-US', region: 'US' },
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; InversorPro/1.0)',
        'Accept':     'application/json',
      },
      timeout: 8000,
    });

    const quotes = response.data?.quoteResponse?.result ?? [];

    if (quotes.length === 0) throw new Error('Respuesta vacía de Yahoo Finance');

    const stocks = quotes.map(q => ({
      symbol:       q.symbol,
      name:         q.shortName || q.longName || q.symbol,
      price:        q.regularMarketPrice ?? 0,
      change24h:    q.regularMarketChangePercent ?? 0,
      changeAbs:    q.regularMarketChange ?? 0,
      volume24h:    q.regularMarketVolume ?? 0,
      marketCap:    q.marketCap ?? 0,
      peRatio:      q.trailingPE ?? null,
      high52w:      q.fiftyTwoWeekHigh ?? 0,
      low52w:       q.fiftyTwoWeekLow ?? 0,
      currency:     q.currency ?? 'USD',
      marketState:  q.marketState ?? 'CLOSED',
      type:         'us_stock',
    }));

    cache.stocks = { data: stocks, timestamp: Date.now() };
    return stocks;

  } catch (error) {
    console.warn('[USStocksService] Error al consultar Yahoo Finance, usando mock:', error.message);
    return getMockUSStocks();
  }
}

/** Mock con datos realistas para las principales acciones del mercado US */
function getMockUSStocks() {
  return [
    { symbol: 'AAPL',  name: 'Apple Inc.',                price: 213.5,  change24h: 0.8,  changeAbs: 1.69,  volume24h: 52e6,  marketCap: 3.27e12, peRatio: 33.2, high52w: 237.2, low52w: 164.1, currency: 'USD', marketState: 'CLOSED', type: 'us_stock' },
    { symbol: 'MSFT',  name: 'Microsoft Corporation',     price: 447.8,  change24h: 1.2,  changeAbs: 5.31,  volume24h: 18e6,  marketCap: 3.33e12, peRatio: 37.8, high52w: 468.4, low52w: 309.4, currency: 'USD', marketState: 'CLOSED', type: 'us_stock' },
    { symbol: 'NVDA',  name: 'NVIDIA Corporation',        price: 1208.9, change24h: 3.4,  changeAbs: 39.75, volume24h: 41e6,  marketCap: 2.98e12, peRatio: 72.1, high52w: 1255.9, low52w: 465.1, currency: 'USD', marketState: 'CLOSED', type: 'us_stock' },
    { symbol: 'TSLA',  name: 'Tesla Inc.',                price: 182.6,  change24h: -2.1, changeAbs: -3.92, volume24h: 95e6,  marketCap: 5.8e11,  peRatio: 48.3, high52w: 299.3, low52w: 138.8, currency: 'USD', marketState: 'CLOSED', type: 'us_stock' },
    { symbol: 'GOOGL', name: 'Alphabet Inc.',             price: 183.4,  change24h: 0.6,  changeAbs: 1.09,  volume24h: 22e6,  marketCap: 2.27e12, peRatio: 25.4, high52w: 193.3, low52w: 115.4, currency: 'USD', marketState: 'CLOSED', type: 'us_stock' },
    { symbol: 'AMZN',  name: 'Amazon.com Inc.',           price: 196.3,  change24h: 1.5,  changeAbs: 2.90,  volume24h: 35e6,  marketCap: 2.07e12, peRatio: 53.7, high52w: 207.6, low52w: 118.4, currency: 'USD', marketState: 'CLOSED', type: 'us_stock' },
    { symbol: 'META',  name: 'Meta Platforms Inc.',       price: 528.7,  change24h: 2.3,  changeAbs: 11.90, volume24h: 14e6,  marketCap: 1.35e12, peRatio: 29.6, high52w: 545.0, low52w: 274.4, currency: 'USD', marketState: 'CLOSED', type: 'us_stock' },
    { symbol: 'BRK-B', name: 'Berkshire Hathaway B',     price: 412.1,  change24h: 0.3,  changeAbs: 1.23,  volume24h: 3.2e6, marketCap: 9.0e11,  peRatio: 22.1, high52w: 425.8, low52w: 330.2, currency: 'USD', marketState: 'CLOSED', type: 'us_stock' },
    { symbol: 'JPM',   name: 'JPMorgan Chase & Co.',      price: 214.8,  change24h: -0.4, changeAbs: -0.86, volume24h: 8.5e6, marketCap: 6.1e11,  peRatio: 12.3, high52w: 226.5, low52w: 139.5, currency: 'USD', marketState: 'CLOSED', type: 'us_stock' },
    { symbol: 'V',     name: 'Visa Inc.',                 price: 285.4,  change24h: 0.7,  changeAbs: 1.99,  volume24h: 5.8e6, marketCap: 5.74e11, peRatio: 31.8, high52w: 299.1, low52w: 223.6, currency: 'USD', marketState: 'CLOSED', type: 'us_stock' },
  ];
}
