/**
 * dashboardRoutes.js — Rutas del dashboard principal
 */

import { Router } from 'express';
import { getDashboardData } from '../controllers/dashboardController.js';

const router = Router();

// GET /api/dashboard — datos completos del dashboard
router.get('/', async (req, res) => {
  try {
    const data = await getDashboardData();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Error al cargar el dashboard', detail: error.message });
  }
});

// GET /api/dashboard/signals — solo las señales del motor de sugerencias
router.get('/signals', async (req, res) => {
  try {
    const data = await getDashboardData();
    res.json({ signals: data.signals, topBuys: data.topBuys, topSells: data.topSells });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener señales', detail: error.message });
  }
});

export default router;
