/**
 * toolsRoutes.js — Rutas para los módulos avanzados:
 *   Arbitraje, Sentimiento, Backtesting y estado del bot de Telegram
 */

import { Router } from 'express';
import {
  getArbitrage,
  getSentiment,
  runBacktest,
  getTelegramStatus,
  getStatus,
} from '../controllers/toolsController.js';

const router = Router();

// GET /api/tools/arbitrage         — oportunidades de arbitraje actuales
router.get('/arbitrage', getArbitrage);

// GET /api/tools/sentiment         — sentimiento de Reddit + noticias
router.get('/sentiment', getSentiment);

// POST /api/tools/backtest         — corre simulación para un activo
// Body: { symbol, name, type, price, change24h, days, initialCapital }
router.post('/backtest', runBacktest);

// GET /api/tools/telegram          — estado del bot de Telegram
router.get('/telegram', getTelegramStatus);

// GET /api/tools/status            — estado (real/mock) de cada fuente de datos
router.get('/status', getStatus);

export default router;
