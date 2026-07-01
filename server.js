/**
 * server.js — Punto de entrada principal de InversorPro
 * Configura Express, middlewares y monta todas las rutas de la API
 */

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './src/database/db.js';
import dashboardRoutes from './src/routes/dashboardRoutes.js';
import portfolioRoutes from './src/routes/portfolioRoutes.js';
import toolsRoutes     from './src/routes/toolsRoutes.js';
import authRoutes      from './src/routes/authRoutes.js';
import { requireAuth, warnIfInsecureProductionConfig } from './src/middleware/auth.js';
import { initTelegramBot } from './src/services/telegramService.js';

// Necesario para usar __dirname con ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middlewares globales ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Servir archivos estáticos del frontend (login.html, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// --- Rutas públicas (sin auth) ---
app.use('/api/auth', authRoutes);

// --- Rutas protegidas (requieren login) ---
app.use('/api/dashboard', requireAuth, dashboardRoutes);
app.use('/api/portfolio', requireAuth, portfolioRoutes);
app.use('/api/tools',     requireAuth, toolsRoutes);

app.get('/api/refresh', requireAuth, async (req, res) => {
  try {
    const { getDashboardData } = await import('./src/controllers/dashboardController.js');
    const data = await getDashboardData();
    res.json({ success: true, data, refreshedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[REFRESH ERROR]', error.message);
    res.status(500).json({ success: false, error: 'Error al actualizar los datos', detail: error.message });
  }
});

// SPA fallback — redirige al login si no está autenticado
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Arranque del servidor ---
async function bootstrap() {
  try {
    // Inicializar la base de datos (JSON store) antes de levantar el servidor
    await initDatabase();
    console.log('[DB] Base de datos inicializada correctamente');

    // Iniciar bot de Telegram si hay token configurado
    initTelegramBot();

    // Advertir si quedan credenciales por defecto al correr en producción
    warnIfInsecureProductionConfig();

    app.listen(PORT, () => {
      console.log(`\n🚀 InversorPro corriendo en http://localhost:${PORT}`);
      console.log(`   Entorno: ${process.env.NODE_ENV || 'development'}`);
      console.log(`   Presiona Ctrl+C para detener\n`);
    });
  } catch (error) {
    console.error('[FATAL] No se pudo iniciar la aplicación:', error);
    process.exit(1);
  }
}

bootstrap();
