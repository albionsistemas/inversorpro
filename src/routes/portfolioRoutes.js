/**
 * portfolioRoutes.js — Rutas REST del portfolio del usuario
 */

import { Router } from 'express';
import { getPortfolio, addPosition, updatePosition, deletePosition } from '../controllers/portfolioController.js';

const router = Router();

router.get('/',       getPortfolio);    // GET    /api/portfolio
router.post('/',      addPosition);     // POST   /api/portfolio
router.put('/:id',    updatePosition);  // PUT    /api/portfolio/:id
router.delete('/:id', deletePosition);  // DELETE /api/portfolio/:id

export default router;
