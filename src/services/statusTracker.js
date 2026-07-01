/**
 * statusTracker.js — Registro centralizado del estado (real/mock) de cada fuente de datos
 *
 * Cada servicio reporta su estado en el punto donde ya decide si sus datos
 * son reales o si cayó al mock de respaldo, sin cambiar la forma de lo que devuelve.
 */

let statuses = {};

/** Registra el estado más reciente de una fuente de datos */
export function reportStatus(key, label, isLive, detail = '') {
  statuses[key] = { key, label, isLive, detail, lastChecked: new Date().toISOString() };
}

/** Retorna el estado de todas las fuentes registradas hasta el momento */
export function getAllStatuses() {
  return Object.values(statuses);
}
