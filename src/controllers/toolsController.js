/**
 * toolsController.js — Controlador para los módulos avanzados
 * Orquesta arbitraje, sentimiento, backtesting y Telegram
 */

import { getCryptoArbitrageOpportunities, getMepArbitrageOpportunities } from '../services/arbitrageService.js';
import { getSentimentSummary }   from '../services/sentimentService.js';
import { runBacktest as _runBacktest } from '../services/backtestService.js';
import { getBotStatus }          from '../services/telegramService.js';

/** GET /api/tools/arbitrage */
export async function getArbitrage(req, res) {
  try {
    const [crypto, mep] = await Promise.allSettled([
      getCryptoArbitrageOpportunities(),
      getMepArbitrageOpportunities(),
    ]);
    res.json({
      crypto: crypto.status === 'fulfilled' ? crypto.value : [],
      mep:    mep.status   === 'fulfilled' ? mep.value   : [],
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener arbitraje', detail: err.message });
  }
}

/** GET /api/tools/sentiment */
export async function getSentiment(req, res) {
  try {
    const data = await getSentimentSummary();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener sentimiento', detail: err.message });
  }
}

/** POST /api/tools/backtest */
export async function runBacktest(req, res) {
  try {
    const { symbol, name, type, price, change24h, days, initialCapital, volatility } = req.body;
    if (!symbol || !price) return res.status(400).json({ error: 'Requerido: symbol, price' });

    const asset = { symbol, name: name || symbol, type: type || 'crypto', price, change24h: change24h || 0 };
    const opts  = {
      days:           parseInt(days)           || 90,
      initialCapital: parseFloat(initialCapital) || 10000,
      volatility:     parseFloat(volatility)    || undefined,
    };

    const result = await _runBacktest(asset, opts);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error en backtest', detail: err.message });
  }
}

/** GET /api/tools/telegram */
export async function getTelegramStatus(req, res) {
  try {
    res.json(getBotStatus());
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener estado del bot', detail: err.message });
  }
}
