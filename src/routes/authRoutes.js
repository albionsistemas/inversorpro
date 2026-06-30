/**
 * authRoutes.js — Endpoints de login y logout
 */

import { Router } from 'express';
import { signToken } from '../middleware/auth.js';

const router = Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;

  const validUser = username === (process.env.LOGIN_USERNAME || 'admin');
  const validPass = password === (process.env.LOGIN_PASSWORD || 'inversorpro123');

  if (!validUser || !validPass) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  const token = signToken(username);
  res.cookie('token', token, {
    httpOnly: true,
    maxAge:   24 * 60 * 60 * 1000, // 24 horas
    sameSite: 'strict',
  });

  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

export default router;
