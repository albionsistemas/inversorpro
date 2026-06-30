/**
 * db.js — Capa de persistencia basada en JSON
 *
 * Reemplaza SQLite para evitar compilación nativa (node-gyp) en Windows.
 * Implementa las mismas operaciones CRUD con archivos JSON + IDs autoincrementales.
 * En producción se puede migrar a PostgreSQL/SQLite con la misma interfaz.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const DATA_DIR   = path.join(__dirname, '../../data');
const DB_FILE    = path.join(DATA_DIR, 'db.json');

// Estructura de la base de datos en memoria
let _db = null;

const EMPTY_DB = {
  portfolio:       [],
  price_history:   [],
  whale_activities:[],
  _counters: { portfolio: 0, price_history: 0, whale_activities: 0 },
};

/** Inicializa la base de datos (crea el archivo si no existe) */
export function initDatabase() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (fs.existsSync(DB_FILE)) {
    try {
      _db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      console.log(`[DB] Base de datos cargada: ${_db.portfolio.length} posiciones en portfolio`);
    } catch {
      console.warn('[DB] Archivo de datos corrupto, reiniciando...');
      _db = structuredClone(EMPTY_DB);
    }
  } else {
    _db = structuredClone(EMPTY_DB);
    seedPortfolio();
    persist();
    console.log('[DB] Base de datos creada con portfolio de ejemplo');
  }
}

/** Retorna la instancia de la base de datos */
export function getDb() {
  if (!_db) throw new Error('Base de datos no inicializada. Llamar a initDatabase() primero.');
  return _db;
}

/** Persiste el estado actual en disco */
function persist() {
  fs.writeFileSync(DB_FILE, JSON.stringify(_db, null, 2), 'utf8');
}

/** Genera el próximo ID autoincrementalfor para una tabla */
function nextId(table) {
  _db._counters[table] = (_db._counters[table] || 0) + 1;
  return _db._counters[table];
}

// ── API genérica de la base de datos ──────────────────────────────────────────

/** Retorna todos los registros de una tabla, ordenados por campo opcional */
export function dbAll(table) {
  return [...(_db[table] ?? [])];
}

/** Inserta un registro y retorna el ID asignado */
export function dbInsert(table, record) {
  const id  = nextId(table);
  const now = new Date().toISOString();
  const row = { id, ...record, created_at: now, updated_at: now };
  _db[table].push(row);
  persist();
  return id;
}

/** Actualiza campos de un registro por ID. Retorna true si encontró el registro */
export function dbUpdate(table, id, fields) {
  const idx = _db[table].findIndex(r => r.id === id);
  if (idx === -1) return false;
  _db[table][idx] = { ..._db[table][idx], ...fields, updated_at: new Date().toISOString() };
  persist();
  return true;
}

/** Elimina un registro por ID. Retorna true si lo encontró */
export function dbDelete(table, id) {
  const before = _db[table].length;
  _db[table]   = _db[table].filter(r => r.id !== id);
  if (_db[table].length < before) { persist(); return true; }
  return false;
}

// ── Datos de ejemplo ──────────────────────────────────────────────────────────

function seedPortfolio() {
  const seed = [
    { symbol: 'BTC',  type: 'crypto',    name: 'Bitcoin',      amount: 0.05, avg_price: 58000, currency: 'USD' },
    { symbol: 'ETH',  type: 'crypto',    name: 'Ethereum',     amount: 0.8,  avg_price: 3100,  currency: 'USD' },
    { symbol: 'AAPL', type: 'us_stock',  name: 'Apple Inc.',   amount: 5,    avg_price: 178,   currency: 'USD' },
    { symbol: 'NVDA', type: 'us_stock',  name: 'NVIDIA Corp.', amount: 2,    avg_price: 780,   currency: 'USD' },
    { symbol: 'GGAL', type: 'argentina', name: 'Grupo Galicia', amount: 100, avg_price: 6800,  currency: 'ARS' },
    { symbol: 'YPFD', type: 'argentina', name: 'YPF S.A.',     amount: 30,   avg_price: 42000, currency: 'ARS' },
  ];
  seed.forEach(r => dbInsert('portfolio', r));
}
