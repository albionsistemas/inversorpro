/**
 * portfolioController.js — CRUD del portfolio del usuario
 * Usa la capa de persistencia JSON de db.js
 */

import { dbAll, dbInsert, dbUpdate, dbDelete } from '../database/db.js';

/** Retorna todas las posiciones con P&L calculado */
export function getPortfolio(req, res) {
  try {
    const holdings = dbAll('portfolio').sort((a, b) => a.type.localeCompare(b.type) || a.symbol.localeCompare(b.symbol));

    const enriched = holdings.map(h => {
      const currentPrice  = getCurrentPriceMock(h.symbol, h.type);
      const totalInvested = h.amount * h.avg_price;
      const currentValue  = h.amount * currentPrice;
      const pnlAbs        = currentValue - totalInvested;
      const pnlPct        = totalInvested > 0 ? (pnlAbs / totalInvested) * 100 : 0;

      return { ...h, currentPrice, totalInvested: +totalInvested.toFixed(2), currentValue: +currentValue.toFixed(2), pnlAbs: +pnlAbs.toFixed(2), pnlPct: +pnlPct.toFixed(2) };
    });

    const totalInvested = enriched.reduce((s, h) => s + h.totalInvested, 0);
    const totalValue    = enriched.reduce((s, h) => s + h.currentValue, 0);
    const totalPnl      = totalValue - totalInvested;

    res.json({
      holdings: enriched,
      summary:  {
        totalInvested: +totalInvested.toFixed(2),
        totalValue:    +totalValue.toFixed(2),
        totalPnl:      +totalPnl.toFixed(2),
        totalPnlPct:   totalInvested > 0 ? +((totalPnl / totalInvested) * 100).toFixed(2) : 0,
        positions:     enriched.length,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener portfolio', detail: error.message });
  }
}

export function addPosition(req, res) {
  try {
    const { symbol, type, name, amount, avg_price, currency } = req.body;
    if (!symbol || !type || !name || amount == null || avg_price == null)
      return res.status(400).json({ error: 'Faltan campos: symbol, type, name, amount, avg_price' });
    if (!['crypto', 'us_stock', 'argentina'].includes(type))
      return res.status(400).json({ error: 'type debe ser: crypto, us_stock o argentina' });

    const id = dbInsert('portfolio', { symbol, type, name, amount, avg_price, currency: currency || 'USD' });
    res.status(201).json({ id, message: 'Posición agregada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al agregar posición', detail: error.message });
  }
}

export function updatePosition(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { amount, avg_price } = req.body;
    const ok = dbUpdate('portfolio', id, { amount, avg_price });
    if (!ok) return res.status(404).json({ error: 'Posición no encontrada' });
    res.json({ message: 'Posición actualizada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar', detail: error.message });
  }
}

export function deletePosition(req, res) {
  try {
    const id = parseInt(req.params.id);
    const ok = dbDelete('portfolio', id);
    if (!ok) return res.status(404).json({ error: 'Posición no encontrada' });
    res.json({ message: 'Posición eliminada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar', detail: error.message });
  }
}

function getCurrentPriceMock(symbol, type) {
  const prices = { BTC: 67450, ETH: 3520, AAPL: 213.5, NVDA: 1208.9, GGAL: 7480, YPFD: 48200 };
  return prices[symbol] ?? 0;
}
