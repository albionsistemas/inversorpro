/**
 * argentinaService.js — Mercado financiero argentino
 *
 * Cotizaciones del dólar: dolarapi.com (gratuita, sin auth, datos del BCRA)
 *   → Oficial, Blue (informal), MEP (Bolsa), CCL (Contado con Liquidación), Tarjeta, Crypto
 *
 * Acciones Merval y CEDEARs: mock con tickers reales del Panel General
 *   → Para conectar a datos reales: InvertirOnline API (requiere auth) o
 *     scraping de https://www.bolsar.com o https://rava.com
 *
 * Manejo dual de moneda: ARS y USD (conversión según tipo de dólar)
 */

import axios from 'axios';
import { reportStatus } from './statusTracker.js';

const DOLAR_API_URL = 'https://dolarapi.com/v1/dolares';
const MERVAL_IDX_URL = 'https://dolarapi.com/v1/indices/merval'; // índice general
const CACHE_TTL_MS  = (parseInt(process.env.CACHE_TTL_MINUTES) || 5) * 60 * 1000;

let cache = { dollars: null, mervalStocks: null };

/**
 * Retorna todas las cotizaciones del dólar en Argentina.
 * Incluye: Oficial, Blue, MEP, CCL, Tarjeta, Crypto (USDT)
 * @returns {Promise<Array>} Array de tipos de dólar con compra/venta en ARS
 */
export async function getDollarRates() {
  if (cache.dollars && Date.now() - cache.dollars.timestamp < CACHE_TTL_MS) {
    return cache.dollars.data;
  }

  try {
    const response = await axios.get(DOLAR_API_URL, { timeout: 7000 });
    const rates = response.data.map(d => ({
      nombre:  d.nombre,
      compra:  d.compra,
      venta:   d.venta,
      // Brecha cambiaria respecto al oficial
      spread:  d.compra > 0 ? ((d.venta / d.compra - 1) * 100).toFixed(1) : 0,
    }));

    cache.dollars = { data: rates, timestamp: Date.now() };
    reportStatus('dolarapi', 'dolarapi.com', true);
    return rates;

  } catch (error) {
    console.warn('[ArgentinaService] Error al obtener cotizaciones dólar, usando mock:', error.message);
    reportStatus('dolarapi', 'dolarapi.com', false, error.message);
    return getMockDollarRates();
  }
}

/**
 * Retorna cotizaciones de acciones del Merval y CEDEARs más operados.
 * Los datos se expresan en ARS; se incluye el precio equivalente en USD MEP.
 * @returns {Promise<{stocks: Array, cedears: Array, mervalIndex: number}>}
 */
export async function getMervalData() {
  if (cache.mervalStocks && Date.now() - cache.mervalStocks.timestamp < CACHE_TTL_MS) {
    return cache.mervalStocks.data;
  }

  // Obtener cotización del dólar MEP para la conversión ARS→USD
  const dollarRates = await getDollarRates();
  const mepRate = dollarRates.find(d => d.nombre?.toLowerCase().includes('mep') || d.nombre?.toLowerCase().includes('bolsa'));
  const mepVenta = mepRate?.venta ?? 1200;

  const stocks  = getMockMervalStocks(mepVenta);
  const cedears = getMockCedears(mepVenta);

  const data = {
    stocks,
    cedears,
    mervalIndex: { value: 2_156_800, change24h: 1.8 }, // Índice Merval en ARS
    dollarMep:   mepVenta,
  };

  cache.mervalStocks = { data, timestamp: Date.now() };
  reportStatus('merval', 'Merval/CEDEARs', false, 'Mock permanente — requiere broker con auth (InvertirOnline/Rava)');
  return data;
}

// --- Mocks realistas del mercado argentino ---

function getMockDollarRates() {
  return [
    { nombre: 'Oficial',  compra: 945,  venta: 985,   spread: '4.2' },
    { nombre: 'Blue',     compra: 1255, venta: 1265,  spread: '0.8' },
    { nombre: 'MEP',      compra: 1218, venta: 1225,  spread: '0.6' },
    { nombre: 'CCL',      compra: 1240, venta: 1250,  spread: '0.8' },
    { nombre: 'Tarjeta',  compra: 0,    venta: 1576,  spread: '0' },
    { nombre: 'Cripto',   compra: 1230, venta: 1245,  spread: '1.2' },
  ];
}

/**
 * Acciones líderes del Panel General del Merval
 * Precios en ARS al cierre del día anterior (mock educativo)
 */
function getMockMervalStocks(mepRate) {
  const stocks = [
    { symbol: 'GGAL',   name: 'Grupo Galicia',          priceArs: 7480,  change24h:  2.3  },
    { symbol: 'YPFD',   name: 'YPF S.A.',               priceArs: 48200, change24h:  1.1  },
    { symbol: 'PAMP',   name: 'Pampa Energía',          priceArs: 6920,  change24h:  0.8  },
    { symbol: 'BMA',    name: 'Banco Macro',            priceArs: 9150,  change24h:  3.2  },
    { symbol: 'TECO2',  name: 'Telecom Argentina',      priceArs: 1280,  change24h: -0.5  },
    { symbol: 'CRES',   name: 'Cresud',                 priceArs: 1720,  change24h:  1.9  },
    { symbol: 'LOMA',   name: 'Loma Negra',             priceArs: 3340,  change24h: -1.2  },
    { symbol: 'ALUA',   name: 'Aluar Aluminio',         priceArs: 1190,  change24h:  0.4  },
    { symbol: 'TXAR',   name: 'Ternium Argentina',      priceArs: 8750,  change24h:  2.7  },
    { symbol: 'COME',   name: 'COME S.A.',              priceArs: 310,   change24h:  1.5  },
  ];

  return stocks.map(s => ({
    ...s,
    // Equivalente en dólares al tipo MEP (inversión legal con CEDEAR)
    priceUsdMep: +(s.priceArs / mepRate).toFixed(2),
    type:        'argentina',
    currency:    'ARS',
  }));
}

/**
 * CEDEARs más operados en Argentina
 * Son ADRs de empresas extranjeras que cotizan en la bolsa local en ARS,
 * con ratio de conversión (cada CEDEAR = fracción del ADR original)
 */
function getMockCedears(mepRate) {
  const cedears = [
    { symbol: 'AAPL',  name: 'Apple (CEDEAR)',    ratio: 10, priceArs: 21400, change24h:  0.8 },
    { symbol: 'MSFT',  name: 'Microsoft (CEDEAR)',ratio: 1,  priceArs: 45800, change24h:  1.2 },
    { symbol: 'GOOGL', name: 'Alphabet (CEDEAR)', ratio: 1,  priceArs: 18900, change24h:  0.6 },
    { symbol: 'AMZN',  name: 'Amazon (CEDEAR)',   ratio: 1,  priceArs: 20200, change24h:  1.5 },
    { symbol: 'TSLA',  name: 'Tesla (CEDEAR)',    ratio: 1,  priceArs: 18700, change24h: -2.1 },
    { symbol: 'NVDA',  name: 'NVIDIA (CEDEAR)',   ratio: 10, priceArs: 12400, change24h:  3.4 },
    { symbol: 'MELI',  name: 'MercadoLibre (CEDEAR)', ratio: 1, priceArs: 195000, change24h: 2.1 },
  ];

  return cedears.map(c => ({
    ...c,
    priceUsdMep: +(c.priceArs / mepRate).toFixed(2),
    type:        'cedear',
    currency:    'ARS',
  }));
}
