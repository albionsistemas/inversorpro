/**
 * dashboardController.js — Orquesta todos los servicios y genera la respuesta del dashboard
 *
 * Flujo:
 *   1. Ejecuta todos los servicios en paralelo (Promise.allSettled) para máxima velocidad
 *   2. Enriquece cada activo con historial simulado de SMAs si no hay datos reales
 *   3. Construye el mapa de sentimiento por activo desde whaleTracker
 *   4. Llama al motor de señales con todos los datos consolidados
 *   5. Retorna un JSON estructurado listo para el frontend
 */

import { getCryptoPrices, getFearGreedIndex } from '../services/cryptoService.js';
import { getUSStockPrices }                   from '../services/usStocksService.js';
import { getDollarRates, getMervalData }       from '../services/argentinaService.js';
import { getWhaleActivities, getAssetSentimentMap } from '../services/whaleTrackerService.js';
import { generateInvestmentSignals, generarHistorialSimulado } from '../services/suggestionsEngine.js';

/**
 * Obtiene y consolida todos los datos del dashboard.
 * @returns {Promise<Object>} Objeto con crypto, usStocks, argentina, whales, signals, meta
 */
export async function getDashboardData() {
  const startTime = Date.now();

  // Ejecutar todos los servicios en paralelo — un fallo no bloquea a los demás
  const [cryptoResult, fearGreedResult, usStocksResult, dollarResult, mervalResult, whaleResult] =
    await Promise.allSettled([
      getCryptoPrices(),
      getFearGreedIndex(),
      getUSStockPrices(),
      getDollarRates(),
      getMervalData(),
      getWhaleActivities(),
    ]);

  // Extraer datos (o array vacío si el servicio falló)
  const cryptoCoins  = cryptoResult.status    === 'fulfilled' ? cryptoResult.value    : [];
  const fearGreed    = fearGreedResult.status  === 'fulfilled' ? fearGreedResult.value  : { value: 50, label: 'Neutral' };
  const usStocks     = usStocksResult.status   === 'fulfilled' ? usStocksResult.value   : [];
  const dollarRates  = dollarResult.status     === 'fulfilled' ? dollarResult.value     : [];
  const mervalData   = mervalResult.status     === 'fulfilled' ? mervalResult.value     : { stocks: [], cedears: [] };
  const whaleData    = whaleResult.status      === 'fulfilled' ? whaleResult.value      : { institutional: [], cryptoWhales: [], sentiment: {} };

  // Calcular brecha cambiaria (CCL vs Oficial) para contexto argentino
  const oficial = dollarRates.find(d => d.nombre?.toLowerCase().includes('oficial'));
  const ccl     = dollarRates.find(d => d.nombre?.toLowerCase() === 'ccl');
  const dollarGap = (oficial?.venta && ccl?.venta)
    ? (ccl.venta - oficial.venta) / oficial.venta
    : 0.28; // brecha estimada si no hay datos

  // Mapa de sentimiento institucional por símbolo
  const sentimentMap = getAssetSentimentMap(whaleData);

  // Enriquecer activos con historial simulado de precios (para SMA)
  const enrichWithHistory = (asset, volatility, trend) => ({
    ...asset,
    priceHistory: generarHistorialSimulado(asset.price, volatility, trend),
    change7d:     asset.change7d ?? (trend * 100 * 7 + (Math.random() - 0.5) * 5),
  });

  const cryptoEnriched = cryptoCoins.map(c =>
    enrichWithHistory(c, 0.04, c.change24h > 0 ? 0.005 : -0.005)
  );
  const usEnriched = usStocks.map(s =>
    enrichWithHistory(s, 0.015, s.change24h > 0 ? 0.002 : -0.002)
  );
  const argEnriched = [
    ...mervalData.stocks.map(s => enrichWithHistory(
      { ...s, price: s.priceArs }, 0.02, s.change24h > 0 ? 0.003 : -0.003
    )),
    ...mervalData.cedears.map(c => enrichWithHistory(
      { ...c, price: c.priceArs }, 0.025, c.change24h > 0 ? 0.003 : -0.003
    )),
  ];

  // Contexto de mercado para el motor de señales
  const marketContext = { fearGreedIndex: fearGreed.value, dollarGap };

  // Generar señales de inversión para todos los activos
  const allAssets = [...cryptoEnriched, ...usEnriched, ...argEnriched];
  const signals   = generateInvestmentSignals(allAssets, sentimentMap, marketContext);

  const elapsed = Date.now() - startTime;

  return {
    meta: {
      updatedAt:    new Date().toISOString(),
      elapsed_ms:   elapsed,
      serviceStatus: {
        crypto:    cryptoResult.status,
        fearGreed: fearGreedResult.status,
        usStocks:  usStocksResult.status,
        dollars:   dollarResult.status,
        merval:    mervalResult.status,
        whales:    whaleResult.status,
      },
    },
    fearGreed,
    dollarRates,
    dollarGap: parseFloat((dollarGap * 100).toFixed(1)),
    crypto:    cryptoCoins,
    usStocks,
    argentina: {
      stocks:       mervalData.stocks,
      cedears:      mervalData.cedears,
      mervalIndex:  mervalData.mervalIndex,
      dollarMep:    mervalData.dollarMep,
    },
    whales:    whaleData,
    signals,   // Señales ordenadas por score
    topBuys:   signals.filter(s => s.signalCode === 'BUY').slice(0, 5),
    topSells:  signals.filter(s => s.signalCode === 'SELL').slice(0, 3),
  };
}
