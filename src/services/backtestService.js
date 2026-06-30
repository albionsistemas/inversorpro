/**
 * backtestService.js — Simulador de backtesting de estrategias
 *
 * Genera historial de precios sintético con Movimiento Browniano Geométrico (GBM)
 * y aplica el motor de señales SMA para evaluar la rentabilidad histórica simulada.
 *
 * ⚠ ADVERTENCIA: Los datos son sintéticos. No representan rendimientos reales.
 *   Usar solo para calibrar parámetros del motor antes de operar con capital real.
 */

import { generateInvestmentSignals } from './suggestionsEngine.js';

// Tasa libre de riesgo anual para el cálculo de Sharpe (5%)
const RISK_FREE_RATE = 0.05;
// Factor de anualización (252 días de mercado por año)
const TRADING_DAYS = 252;

// ── Generación de números aleatorios ─────────────────────────────────────────

/**
 * Genera N variables aleatorias con distribución Normal(0,1) usando Box-Muller.
 * @param {number} n - Cantidad de variables a generar
 * @returns {number[]}
 */
function generarNormalesBoxMuller(n) {
  const result = [];
  for (let i = 0; i < n; i++) {
    const u1 = Math.random();
    const u2 = Math.random();
    result.push(Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2));
  }
  return result;
}

/**
 * Genera historial de precios usando GBM, anclado al precio actual.
 * Genera la serie HACIA ATRÁS para que el último precio sea el precio actual.
 *
 * Fórmula: P(t) = P(t-1) * exp((drift - vol²/2)*dt + vol*sqrt(dt)*Z)
 *
 * @param {number} precioActual  - Precio de hoy (último punto de la serie)
 * @param {number} dias          - Días de historia a generar
 * @param {number} volatilidad   - Volatilidad diaria (ej: 0.04 = 4%)
 * @param {number} drift         - Tendencia diaria (ej: 0.001 = 0.1%/día)
 * @returns {number[]} Array de precios [más_antiguo, ..., precioActual]
 */
function generarHistorialGBM(precioActual, dias, volatilidad = 0.03, drift = 0.001) {
  const dt        = 1;
  const normales  = generarNormalesBoxMuller(dias);
  const retornos  = normales.map(z =>
    Math.exp((drift - 0.5 * volatilidad ** 2) * dt + volatilidad * Math.sqrt(dt) * z)
  );

  // Generar hacia atrás: empezamos desde el precio actual y revertimos los retornos
  const precios = new Array(dias + 1);
  precios[dias] = precioActual;
  for (let i = dias - 1; i >= 0; i--) {
    precios[i] = precios[i + 1] / retornos[i];
  }

  return precios;
}

// ── Métricas de rendimiento ────────────────────────────────────────────────────

/**
 * Calcula el máximo drawdown de una curva de equity.
 * @param {number[]} equity - Serie de valores del portfolio
 * @returns {number} Drawdown máximo como porcentaje negativo (ej: -18.5)
 */
function calcularMaxDrawdown(equity) {
  let pico    = equity[0];
  let maxDD   = 0;
  for (const val of equity) {
    if (val > pico) pico = val;
    const dd = (val - pico) / pico * 100;
    if (dd < maxDD) maxDD = dd;
  }
  return +maxDD.toFixed(2);
}

/**
 * Calcula el Sharpe Ratio anualizado.
 * Sharpe = (retorno_anualizado - tasa_libre_riesgo) / volatilidad_anualizada
 *
 * @param {number[]} retornosDiarios - Array de retornos diarios (ej: [0.01, -0.005, ...])
 * @returns {number}
 */
function calcularSharpe(retornosDiarios) {
  if (retornosDiarios.length < 2) return 0;
  const media = retornosDiarios.reduce((a, b) => a + b, 0) / retornosDiarios.length;
  const varianza = retornosDiarios.reduce((a, r) => a + (r - media) ** 2, 0) / retornosDiarios.length;
  const volDiaria = Math.sqrt(varianza);
  if (volDiaria === 0) return 0;
  const retornoAnualizado = media * TRADING_DAYS;
  const volAnualizada     = volDiaria * Math.sqrt(TRADING_DAYS);
  return +((retornoAnualizado - RISK_FREE_RATE) / volAnualizada).toFixed(2);
}

/**
 * Calcula el porcentaje de operaciones ganadoras (win rate).
 * @param {Array<{action, capital}>} operaciones - Lista de trades
 * @returns {number} Win rate en porcentaje (0-100)
 */
function calcularWinRate(operaciones) {
  let wins = 0;
  let total = 0;
  let capitalCompra = null;

  for (const op of operaciones) {
    if (op.action === 'BUY') {
      capitalCompra = op.capital;
    } else if (op.action === 'SELL' && capitalCompra !== null) {
      total++;
      if (op.capital > capitalCompra) wins++;
      capitalCompra = null;
    }
  }

  return total > 0 ? +((wins / total) * 100).toFixed(1) : 0;
}

// ── Backtesting principal ─────────────────────────────────────────────────────

/**
 * Corre el backtest para un activo durante N días.
 *
 * Lógica de posición:
 *   - Si señal = COMPRAR y estamos en CASH → comprar al precio del día
 *   - Si señal = VENDER  y estamos en INVESTED → vender al precio del día
 *   - Comisión de trading: 0.3% por operación
 *
 * @param {Object} asset   - { symbol, name, type, price, change24h }
 * @param {Object} options - { days, initialCapital, volatility, trend }
 * @returns {Object} Resultado completo del backtest
 */
export async function runBacktest(asset, options = {}) {
  const {
    days           = 90,
    initialCapital = 10000,
    volatility     = getVolByType(asset.type),
    trend          = 0.0005,
  } = options;

  const FEE = 0.003; // comisión 0.3% por operación

  // Generar historial de precios sintético
  const precios = generarHistorialGBM(asset.price, days, volatility, trend);

  // Estado de la simulación
  let capital      = initialCapital;
  let unidades     = 0;         // unidades del activo en cartera
  let estado       = 'CASH';    // 'CASH' | 'INVESTED'
  const equity     = [capital]; // curva de equity día a día
  const retornos   = [];
  const trades     = [];
  const equityCurva = [{ day: 0, value: capital, signal: 'HOLD', price: precios[0] }];

  for (let i = 21; i <= days; i++) {
    const ventana = precios.slice(i - 21, i + 1);
    const historial = ventana.map((p, idx) => ({ price: p, timestamp: new Date(Date.now() - (21 - idx) * 86400000).toISOString() }));

    // Construir activo temporal con historial para el motor de señales
    const assetConHistorial = {
      ...asset,
      price:        precios[i],
      change24h:    i > 0 ? (precios[i] - precios[i-1]) / precios[i-1] * 100 : 0,
      change7d:     i >= 7 ? (precios[i] - precios[i-7]) / precios[i-7] * 100 : 0,
      priceHistory: historial,
    };

    const [señal] = generateInvestmentSignals([assetConHistorial], {}, {});
    const precioHoy = precios[i];

    // Ejecutar operación según señal
    if (señal.signalCode === 'BUY' && estado === 'CASH') {
      const capitalTrade = capital * (1 - FEE);
      unidades = capitalTrade / precioHoy;
      capital  = 0;
      estado   = 'INVESTED';
      trades.push({ day: i, action: 'BUY', price: +precioHoy.toFixed(4), capital: +capitalTrade.toFixed(2) });

    } else if (señal.signalCode === 'SELL' && estado === 'INVESTED') {
      capital  = unidades * precioHoy * (1 - FEE);
      unidades = 0;
      estado   = 'CASH';
      trades.push({ day: i, action: 'SELL', price: +precioHoy.toFixed(4), capital: +capital.toFixed(2) });
    }

    // Valor actual del portfolio
    const valorPortfolio = estado === 'INVESTED' ? unidades * precioHoy : capital;
    const retornoDia     = equity.length > 0 ? (valorPortfolio - equity[equity.length - 1]) / equity[equity.length - 1] : 0;
    equity.push(valorPortfolio);
    if (!isNaN(retornoDia)) retornos.push(retornoDia);

    // Guardar punto en la curva cada 5 días (o el último)
    if (i % 5 === 0 || i === days) {
      equityCurva.push({ day: i, value: +valorPortfolio.toFixed(2), signal: señal.signalCode, price: +precioHoy.toFixed(4) });
    }
  }

  // Si terminamos invertidos, liquidar al último precio
  if (estado === 'INVESTED') {
    const valorFinal = unidades * precios[days];
    capital = valorFinal * (1 - FEE);
  }

  const capitalFinal    = estado === 'INVESTED' ? unidades * precios[days] : capital;
  const totalReturn     = +((capitalFinal - initialCapital) / initialCapital * 100).toFixed(2);
  const buyAndHold      = +((precios[days] - precios[0]) / precios[0] * 100).toFixed(2);
  const maxDrawdown     = calcularMaxDrawdown(equity);
  const sharpeRatio     = calcularSharpe(retornos);
  const winRate         = calcularWinRate(trades);

  return {
    symbol:              asset.symbol,
    name:                asset.name,
    type:                asset.type,
    period:              `${days} días`,
    initialCapital:      +initialCapital.toFixed(2),
    finalCapital:        +capitalFinal.toFixed(2),
    totalReturn,
    maxDrawdown,
    winRate,
    totalTrades:         trades.length,
    buyAndHoldReturn:    buyAndHold,
    strategyVsBuyHold:   +(totalReturn - buyAndHold).toFixed(2),
    sharpeRatio,
    equityCurve:         equityCurva,
    trades,
    disclaimer: 'Simulación con precios sintéticos (GBM). No representa rendimientos reales pasados ni futuros.',
  };
}

/**
 * Backtest multi-activo con capital distribuido en partes iguales.
 * @param {Array}  assets  - Lista de activos
 * @param {Object} options - Opciones comunes (days, initialCapital)
 * @returns {Object} Resultados individuales + métricas del portfolio consolidado
 */
export async function runMultiAssetBacktest(assets, options = {}) {
  if (!assets?.length) return { results: [], portfolio: null };

  const capitalPorActivo = (options.initialCapital ?? 10000) / assets.length;

  const resultados = await Promise.all(
    assets.map(a => runBacktest(a, { ...options, initialCapital: capitalPorActivo }))
  );

  const totalInvested = resultados.reduce((s, r) => s + r.initialCapital, 0);
  const totalFinal    = resultados.reduce((s, r) => s + r.finalCapital, 0);

  return {
    results: resultados.sort((a, b) => b.totalReturn - a.totalReturn),
    portfolio: {
      initialCapital:   +totalInvested.toFixed(2),
      finalCapital:     +totalFinal.toFixed(2),
      totalReturn:      +((totalFinal - totalInvested) / totalInvested * 100).toFixed(2),
      bestAsset:        resultados.sort((a, b) => b.totalReturn - a.totalReturn)[0]?.symbol,
      worstAsset:       resultados.sort((a, b) => a.totalReturn - b.totalReturn)[0]?.symbol,
      avgSharpe:        +(resultados.reduce((s, r) => s + r.sharpeRatio, 0) / resultados.length).toFixed(2),
    },
  };
}

// ── Utilidades ─────────────────────────────────────────────────────────────────

/** Volatilidad diaria por tipo de activo (basada en datos históricos típicos) */
function getVolByType(type) {
  const map = { crypto: 0.045, us_stock: 0.018, argentina: 0.025, cedear: 0.028 };
  return map[type] ?? 0.03;
}
