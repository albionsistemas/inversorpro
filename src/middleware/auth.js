/**
 * auth.js — Middleware de autenticación por JWT en cookie httpOnly
 */

import jwt from 'jsonwebtoken';
import { getCredentials } from '../database/db.js';

const DEFAULT_SECRET   = 'inversorpro_dev_secret_cambiar_en_produccion';
const DEFAULT_PASSWORD = 'inversorpro123';
const SECRET = process.env.JWT_SECRET || DEFAULT_SECRET;

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

/** Advierte en consola si el servidor corre en producción con credenciales por defecto */
export function warnIfInsecureProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;

  const warnings = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'cambiar_este_secreto_por_uno_aleatorio_largo') {
    warnings.push(`JWT_SECRET no fue cambiado del valor de ejemplo — usando "${DEFAULT_SECRET}" (inseguro).`);
  }
  if (!getCredentials() && (!process.env.LOGIN_PASSWORD || process.env.LOGIN_PASSWORD === DEFAULT_PASSWORD)) {
    warnings.push(`LOGIN_PASSWORD no fue cambiado del valor de ejemplo y la contraseña nunca fue actualizada — usando "${DEFAULT_PASSWORD}" (inseguro).`);
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  ADVERTENCIA DE SEGURIDAD ⚠️');
    warnings.forEach(w => console.warn(`   - ${w}`));
    console.warn('   Configurá estas variables en .env antes de exponer la app públicamente.\n');
  }
}
