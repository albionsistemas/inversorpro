/**
 * auth.js — Middleware de autenticación por JWT en cookie httpOnly
 */

import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'inversorpro_dev_secret_cambiar_en_produccion';

export function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'No autorizado', redirect: '/login' });

  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Sesión expirada', redirect: '/login' });
  }
}

export function signToken(username) {
  return jwt.sign({ username }, SECRET, { expiresIn: '24h' });
}
