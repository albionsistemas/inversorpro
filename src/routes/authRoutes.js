/**
 * authRoutes.js — Endpoints de autenticación: login, logout, cambio de contraseña
 */

import { Router }                       from 'express';
import bcrypt                           from 'bcryptjs';
import { signToken }                    from '../middleware/auth.js';
import { requireAuth }                  from '../middleware/auth.js';
import { loginLimiter, changePasswordLimiter } from '../middleware/rateLimit.js';
import { getCredentials, setCredentials } from '../database/db.js';

const router = Router();

// ── Login ─────────────────────────────────────────────────────────────────────

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Faltan campos requeridos' });

  const creds = getCredentials();
  let valid   = false;

  if (creds) {
    // Contraseña fue cambiada: verificar con bcrypt
    valid = username === creds.username && await bcrypt.compare(password, creds.passwordHash);
  } else {
    // Contraseña por defecto desde .env
    valid = username === (process.env.LOGIN_USERNAME || 'admin')
         && password === (process.env.LOGIN_PASSWORD || 'inversorpro123');
  }

  if (!valid) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

  const token = signToken(username);
  res.cookie('token', token, {
    httpOnly: true,
    maxAge:   24 * 60 * 60 * 1000,
    sameSite: 'strict',
    secure:   process.env.NODE_ENV === 'production',
  });
  res.json({ ok: true });
});

// ── Logout ────────────────────────────────────────────────────────────────────

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// ── Verificar sesión ──────────────────────────────────────────────────────────

router.get('/check', requireAuth, (req, res) => {
  res.json({ ok: true, username: req.user.username });
});

// ── Cambiar contraseña ────────────────────────────────────────────────────────

router.post('/change-password', requireAuth, changePasswordLimiter, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'Las contraseñas nuevas no coinciden' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'La nueva contraseña debe ser diferente a la actual' });
  }

  // Verificar contraseña actual
  const creds = getCredentials();
  let valid   = false;

  if (creds) {
    valid = await bcrypt.compare(currentPassword, creds.passwordHash);
  } else {
    valid = currentPassword === (process.env.LOGIN_PASSWORD || 'inversorpro123');
  }

  if (!valid) return res.status(401).json({ error: 'Contraseña actual incorrecta' });

  // Guardar nueva contraseña hasheada
  const hash = await bcrypt.hash(newPassword, 12);
  setCredentials(req.user.username, hash);

  res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
});

export default router;
