/**
 * suggestionsEngine.js — Motor de señales de inversión
 *
 * Genera señales COMPRAR / MANTENER / VENDER ponderando tres factores:
 *
 *   1. Tendencia de precio (40%) — cruce de medias móviles SMA7 vs SMA21
 *      + variación 24h y 7d como indicadores de impulso (momentum)
 *
 *   2. Sentimiento institucional / ballenas (40%) — señal agregada del
 *      whaleTrackerService: acumulación (+1) a distribución (-1)
 *
 *   3. Contexto de mercado (20%) — Fear & Greed Index para crypto;
 *      brecha cambiaria y riesgo macro para activos argentinos
 *
 * Score total normalizado en [-1, 1]:
 *   >= 0.25  → COMPRAR  (oportunidad identificada)
 *   <= -0.25 → VENDER   (señal de salida / reducir exposición)
 *   entre    → MANTENER (sin señal clara, esperar confirmación)
 */

/**
 * Calcula la Media Móvil Simple para los últimos `period` precios.
 * @param {number[]} prices - Array de precios históricos (más antiguo primero)
 * @param {number}   period - Cantidad de períodos (ej: 7 o 21)
 * @returns {number|null} SMA o null si no hay suficientes datos
 */
function calcularSMA(prices, period) {
  if (!prices || prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((acc, p) => acc + p, 0) / period;
}

/**
 * Genera señales de inversión para un array de activos.
 *
 * @param {Array}  assets       - Lista de activos con sus datos de precio
 * @param {Object} sentimentMap - Mapa symbol → score (-1 a 1) del whaleTracker
 * @param {Object} marketCtx    - Contexto global: { fearGreedIndex, dollarGap }
 * @returns {Array} Señales ordenadas por score descendente
 */
export function generateInvestmentSignals(assets, sentimentMap = {}, marketCtx = {}) {
  const signals = assets.map(asset => {
    const reasons   = [];
    let   trendScore   = 0;
    let   whaleScore   = 0;
    let   contextScore = 0;

    // ── 1. TENDENCIA DE PRECIO (peso 40%) ─────────────────────────────────
    const prices = asset.priceHistory?.map(h => h.price) ?? [];
    const sma7   = calcularSMA(prices, 7);
    const sma21  = calcularSMA(prices, 21);

    if (sma7 !== null && sma21 !== null) {
      const smaDiff = (sma7 - sma21) / sma21; // diferencia relativa

      if (smaDiff > 0.03) {
        trendScore += 0.8;
        reasons.push(`SMA7 (${fmt(sma7)}) por encima de SMA21 (${fmt(sma21)}) en +${(smaDiff*100).toFixed(1)}% → tendencia alcista`);
      } else if (smaDiff > 0.01) {
        trendScore += 0.4;
        reasons.push('SMA7 levemente sobre SMA21 → arranque de tendencia alcista');
      } else if (smaDiff < -0.03) {
        trendScore -= 0.8;
        reasons.push(`SMA7 (${fmt(sma7)}) por debajo de SMA21 (${fmt(sma21)}) → tendencia bajista`);
      } else if (smaDiff < -0.01) {
        trendScore -= 0.4;
        reasons.push('SMA7 levemente bajo SMA21 → arranque de tendencia bajista');
      } else {
        reasons.push('SMAs convergentes → mercado lateral sin dirección clara');
      }
    }

    // Impulso (momentum) de precio
    const ch24h = asset.change24h ?? 0;
    const ch7d  = asset.change7d  ?? 0;

    if (ch24h > 5)       { trendScore += 0.3; reasons.push(`Suba de +${ch24h.toFixed(1)}% en 24h (momentum positivo)`); }
    else if (ch24h < -5) { trendScore -= 0.3; reasons.push(`Caída de ${ch24h.toFixed(1)}% en 24h (momentum negativo)`); }

    if (ch7d > 15)       { trendScore += 0.2; reasons.push(`Rally semanal de +${ch7d.toFixed(1)}%`); }
    else if (ch7d < -15) { trendScore -= 0.2; reasons.push(`Corrección semanal de ${ch7d.toFixed(1)}%`); }

    // Clampear trendScore a [-1, 1]
    trendScore = clamp(trendScore, -1, 1);

    // ── 2. SENTIMIENTO INSTITUCIONAL / BALLENAS (peso 40%) ────────────────
    whaleScore = sentimentMap[asset.symbol] ?? 0;

    if (whaleScore > 0.5)       reasons.push('Inversores institucionales en modo acumulación activa');
    else if (whaleScore > 0.2)  reasons.push('Leve acumulación institucional detectada');
    else if (whaleScore < -0.5) reasons.push('Inversores institucionales distribuyendo posiciones');
    else if (whaleScore < -0.2) reasons.push('Leve distribución institucional detectada');
    else                        reasons.push('Actividad institucional neutral o sin datos suficientes');

    // ── 3. CONTEXTO DE MERCADO (peso 20%) ─────────────────────────────────
    if (asset.type === 'crypto') {
      const fg = marketCtx.fearGreedIndex ?? 50;

      if      (fg <= 20) { contextScore =  1.0; reasons.push(`Fear & Greed en ${fg} (Miedo Extremo) → oportunidad histórica de compra`); }
      else if (fg <= 35) { contextScore =  0.5; reasons.push(`Fear & Greed en ${fg} (Miedo) → zona de posible acumulación`); }
      else if (fg <= 60) { contextScore =  0.0; reasons.push(`Fear & Greed en ${fg} (Neutral)`); }
      else if (fg <= 75) { contextScore = -0.3; reasons.push(`Fear & Greed en ${fg} (Codicia) → mercado caliente, precaución`); }
      else               { contextScore = -0.8; reasons.push(`Fear & Greed en ${fg} (Codicia Extrema) → señal de techo de mercado`); }

    } else if (asset.type === 'argentina' || asset.type === 'cedear') {
      const gap = marketCtx.dollarGap ?? 0;
      // Brecha cambiaria > 30%: riesgo macro elevado
      if (gap > 0.5) {
        contextScore = -0.5;
        reasons.push(`Brecha cambiaria de ${(gap*100).toFixed(0)}% (riesgo macro muy elevado)`);
      } else if (gap > 0.3) {
        contextScore = -0.2;
        reasons.push(`Brecha cambiaria de ${(gap*100).toFixed(0)}% (riesgo macro moderado)`);
      } else {
        contextScore = 0.2;
        reasons.push(`Brecha cambiaria controlada en ${(gap*100).toFixed(0)}%`);
      }
    }

    // ── SCORE FINAL PONDERADO ──────────────────────────────────────────────
    const finalScore = (trendScore * 0.4) + (whaleScore * 0.4) + (contextScore * 0.2);

    let signal, signalCode, confidence;
    if (finalScore >= 0.4) {
      signal = 'COMPRAR'; signalCode = 'BUY';  confidence = 'Alta';
    } else if (finalScore >= 0.25) {
      signal = 'COMPRAR'; signalCode = 'BUY';  confidence = 'Moderada';
    } else if (finalScore <= -0.4) {
      signal = 'VENDER';  signalCode = 'SELL'; confidence = 'Alta';
    } else if (finalScore <= -0.25) {
      signal = 'VENDER';  signalCode = 'SELL'; confidence = 'Moderada';
    } else {
      signal = 'MANTENER'; signalCode = 'HOLD'; confidence = 'Moderada';
    }

    return {
      symbol:      asset.symbol,
      name:        asset.name,
      type:        asset.type,
      price:       asset.price,
      change24h:   ch24h,
      signal,
      signalCode,
      confidence,
      score:       parseFloat(finalScore.toFixed(3)),
      reason:      reasons.join('. '),
      breakdown:   { trendScore: +trendScore.toFixed(2), whaleScore: +whaleScore.toFixed(2), contextScore: +contextScore.toFixed(2) },
      generatedAt: new Date().toISOString(),
    };
  });

  // Ordenar: primero COMPRAR (mayor score), luego MANTENER, luego VENDER
  return signals.sort((a, b) => b.score - a.score);
}

// --- Utilidades ---

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

function fmt(n) {
  if (n >= 1e6)  return `$${(n/1e6).toFixed(2)}M`;
  if (n >= 1000) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(4)}`;
}

/**
 * Genera un historial de precios simulado para activos que no tienen datos históricos.
 * Útil para demostrar el funcionamiento de las SMAs en modo mock.
 * @param {number} currentPrice - Precio actual del activo
 * @param {number} volatility   - Volatilidad diaria como fracción (ej: 0.03 = 3%)
 * @param {number} trend        - Tendencia: positivo = alcista, negativo = bajista
 * @returns {Array<{price: number, timestamp: string}>}
 */
export function generarHistorialSimulado(currentPrice, volatility = 0.025, trend = 0) {
  const history = [];
  let price = currentPrice * (1 - trend * 21); // precio 21 días atrás

  for (let i = 21; i >= 0; i--) {
    price = price * (1 + trend + (Math.random() - 0.5) * volatility * 2);
    const date = new Date();
    date.setDate(date.getDate() - i);
    history.push({ price: +price.toFixed(6), timestamp: date.toISOString() });
  }

  return history;
}
