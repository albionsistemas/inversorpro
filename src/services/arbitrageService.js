/**
 * arbitrageService.js — Detección de oportunidades de arbitraje
 *
 * Fuente de datos: API pública de Criptoya (https://criptoya.com)
 *   - GET /api/{coin}/{fiat}/{volume}: precios en todos los exchanges argentinos
 *   - GET /api/dolar: cotizaciones MEP/CCL de distintos proveedores
 *
 * Lógica:
 *   1. Consultar precios en todos los exchanges disponibles
 *   2. Detectar brecha entre ask más bajo (mejor precio de compra)
 *      y bid más alto (mejor precio de venta) en exchanges distintos
 *   3. Calcular ganancia neta descontando comisiones estimadas (0.5% por lado)
 *   4. Reportar solo oportunidades con ganancia neta > MIN_NET_PROFIT (0.3%)
 *
 * Caché: 2 minutos (los precios cambian rápidamente)
 */

import axios from 'axios';

const CRIPTOYA_BASE  = 'https://criptoya.com/api';
const CACHE_TTL_MS   = 2 * 60 * 1000;
const FEE_PER_SIDE   = 0.5;
const FEE_ROUND_TRIP = FEE_PER_SIDE * 2; // 1% total compra+venta
const MIN_NET_PROFIT = 0.3;
const EXAMPLE_VOLUME = 10_000;           // ARS de referencia para estimar ganancia

// Pares cripto/ARS a analizar
const CRYPTO_PAIRS = [
  { coin: 'usdt', symbol: 'USDT', volume: 1     },
  { coin: 'btc',  symbol: 'BTC',  volume: 0.001 },
  { coin: 'eth',  symbol: 'ETH',  volume: 0.01  },
];

const TIPOS_DOLAR_MEP = ['mep', 'bolsa', 'ccl', 'contadoconliqui'];

let cache = { crypto: null, mep: null };

function esCacheValida(entrada) {
  return entrada !== null && Date.now() - entrada.timestamp < CACHE_TTL_MS;
}

// ── Arbitraje Cripto ──────────────────────────────────────────────────────────

/**
 * Detecta oportunidades de arbitraje de criptomonedas entre exchanges argentinos.
 * Consulta USDT, BTC y ETH contra ARS en todos los exchanges disponibles.
 * @returns {Promise<Array>}
 */
export async function getCryptoArbitrageOpportunities() {
  if (esCacheValida(cache.crypto)) return cache.crypto.data;

  try {
    const peticiones = CRYPTO_PAIRS.map(par =>
      axios
        .get(`${CRIPTOYA_BASE}/${par.coin}/ars/${par.volume}`, { timeout: 8000 })
        .then(res => ({ par, exchanges: res.data }))
        .catch(err => {
          console.warn(`[ArbitrageService] Error ${par.symbol}/ARS:`, err.message);
          return null;
        })
    );

    const resultados    = await Promise.all(peticiones);
    const oportunidades = resultados
      .filter(Boolean)
      .map(r => analizarArbitrajeCripto(r.par.symbol, r.exchanges))
      .filter(Boolean)
      .sort((a, b) => b.netProfitPct - a.netProfitPct);

    cache.crypto = { data: oportunidades, timestamp: Date.now() };
    return oportunidades;

  } catch (error) {
    console.warn('[ArbitrageService] Fallback a mock cripto:', error.message);
    return getMockCryptoArbitrage();
  }
}

function analizarArbitrajeCripto(symbol, exchanges) {
  const validos = [];

  for (const [nombre, datos] of Object.entries(exchanges)) {
    if (typeof datos !== 'object' || datos === null) continue;
    const ask = datos.totalAsk ?? datos.ask ?? 0;
    const bid = datos.totalBid ?? datos.bid ?? 0;
    if (ask > 0 && bid > 0 && ask >= bid) {
      validos.push({ exchange: nombre, ask, bid });
    }
  }

  if (validos.length < 2) return null;

  const mejorCompra = validos.reduce((min, ex) => ex.ask < min.ask ? ex : min);
  const mejorVenta  = validos.reduce((max, ex) => ex.bid > max.bid ? ex : max);

  if (mejorCompra.exchange === mejorVenta.exchange) return null;

  const grossSpreadPct = ((mejorVenta.bid - mejorCompra.ask) / mejorCompra.ask) * 100;
  const netProfitPct   = grossSpreadPct - FEE_ROUND_TRIP;

  if (netProfitPct <= MIN_NET_PROFIT) return null;

  return {
    coin:            symbol,
    buyExchange:     mejorCompra.exchange,
    buyPrice:        mejorCompra.ask,
    sellExchange:    mejorVenta.exchange,
    sellPrice:       mejorVenta.bid,
    grossSpreadPct:  +grossSpreadPct.toFixed(2),
    netProfitPct:    +netProfitPct.toFixed(2),
    estimatedFeePct: FEE_ROUND_TRIP,
    volumeArs:       EXAMPLE_VOLUME,
    profitArs:       +((EXAMPLE_VOLUME * netProfitPct) / 100).toFixed(2),
    type:            'crypto',
    detectedAt:      new Date().toISOString(),
    isViable:        true,
  };
}

// ── Arbitraje Dólar MEP ───────────────────────────────────────────────────────

/**
 * Detecta diferencias de precio entre proveedores de Dólar MEP/CCL.
 * @returns {Promise<Array>}
 */
export async function getMepArbitrageOpportunities() {
  if (esCacheValida(cache.mep)) return cache.mep.data;

  try {
    const response  = await axios.get(`${CRIPTOYA_BASE}/dolar`, { timeout: 8000 });
    const oportunidades = analizarOportunidadesMep(response.data)
      .sort((a, b) => b.netProfitPct - a.netProfitPct);

    cache.mep = { data: oportunidades, timestamp: Date.now() };
    return oportunidades;

  } catch (error) {
    console.warn('[ArbitrageService] Fallback a mock MEP:', error.message);
    return getMockMepArbitrage();
  }
}

function extraerTasasMep(data) {
  const tasas = [];
  for (const [clave, valor] of Object.entries(data)) {
    if (typeof valor !== 'object' || valor === null) continue;
    const claveLower = clave.toLowerCase();
    const esTipoMep  = TIPOS_DOLAR_MEP.some(tipo => claveLower.includes(tipo));

    if (esTipoMep) {
      const ask = valor.ask ?? valor.venta  ?? 0;
      const bid = valor.bid ?? valor.compra ?? 0;
      if (ask > 0 && bid > 0) tasas.push({ proveedor: clave, ask, bid });

      // Formato anidado por bono: { mep: { al30: { ask, bid }, gd30: {...} } }
      for (const [sub, subval] of Object.entries(valor)) {
        if (typeof subval !== 'object' || subval === null) continue;
        const askSub = subval.ask ?? subval.sell  ?? subval.price ?? 0;
        const bidSub = subval.bid ?? subval.buy   ?? 0;
        if (askSub > 0 && bidSub > 0) tasas.push({ proveedor: `${clave}_${sub}`, ask: askSub, bid: bidSub });
      }
    } else {
      // Formato por proveedor: { iol: { mep: { ask, bid } } }
      for (const [tipoClave, tipoValor] of Object.entries(valor)) {
        if (typeof tipoValor !== 'object' || tipoValor === null) continue;
        if (!TIPOS_DOLAR_MEP.some(tipo => tipoClave.toLowerCase().includes(tipo))) continue;
        const ask = tipoValor.ask ?? tipoValor.sell ?? tipoValor.venta  ?? 0;
        const bid = tipoValor.bid ?? tipoValor.buy  ?? tipoValor.compra ?? 0;
        if (ask > 0 && bid > 0) tasas.push({ proveedor: `${clave}_${tipoClave}`, ask, bid });
      }
    }
  }
  return tasas;
}

function analizarOportunidadesMep(dolarData) {
  const tasas = extraerTasasMep(dolarData);
  if (tasas.length < 2) return [];

  const mejorCompra = tasas.reduce((min, t) => t.ask < min.ask ? t : min);
  const mejorVenta  = tasas.reduce((max, t) => t.bid > max.bid ? t : max);
  if (mejorCompra.proveedor === mejorVenta.proveedor) return [];

  const grossSpreadPct = ((mejorVenta.bid - mejorCompra.ask) / mejorCompra.ask) * 100;
  const netProfitPct   = grossSpreadPct - FEE_ROUND_TRIP;
  if (netProfitPct <= MIN_NET_PROFIT) return [];

  return [{
    coin:            'USD_MEP',
    buyExchange:     mejorCompra.proveedor,
    buyPrice:        mejorCompra.ask,
    sellExchange:    mejorVenta.proveedor,
    sellPrice:       mejorVenta.bid,
    grossSpreadPct:  +grossSpreadPct.toFixed(2),
    netProfitPct:    +netProfitPct.toFixed(2),
    estimatedFeePct: FEE_ROUND_TRIP,
    volumeArs:       EXAMPLE_VOLUME,
    profitArs:       +((EXAMPLE_VOLUME * netProfitPct) / 100).toFixed(2),
    type:            'dolar_mep',
    detectedAt:      new Date().toISOString(),
    isViable:        true,
  }];
}

// ── Mock de respaldo ──────────────────────────────────────────────────────────

function getMockCryptoArbitrage() {
  const now = new Date().toISOString();
  return [
    { coin: 'USDT', buyExchange: 'letsbit', buyPrice: 1238.50, sellExchange: 'buenbit',
      sellPrice: 1256.20, grossSpreadPct: 1.43, netProfitPct: 0.43,
      estimatedFeePct: FEE_ROUND_TRIP, volumeArs: EXAMPLE_VOLUME, profitArs: 43,
      type: 'crypto', detectedAt: now, isViable: true },
    { coin: 'ETH', buyExchange: 'ripio', buyPrice: 4_312_000, sellExchange: 'fiwind',
      sellPrice: 4_368_500, grossSpreadPct: 1.31, netProfitPct: 0.31,
      estimatedFeePct: FEE_ROUND_TRIP, volumeArs: EXAMPLE_VOLUME, profitArs: 31,
      type: 'crypto', detectedAt: now, isViable: true },
  ];
}

function getMockMepArbitrage() {
  return [{
    coin: 'USD_MEP', buyExchange: 'mep_al30', buyPrice: 1220, sellExchange: 'mep_gd30',
    sellPrice: 1238.50, grossSpreadPct: 1.52, netProfitPct: 0.52,
    estimatedFeePct: FEE_ROUND_TRIP, volumeArs: EXAMPLE_VOLUME, profitArs: 52,
    type: 'dolar_mep', detectedAt: new Date().toISOString(), isViable: true,
  }];
}
