/**
 * telegramService.js — Bot de Telegram para alertas de inversión
 *
 * Usa la librería Telegraf (https://telegraf.js.org) con modo polling.
 * Si TELEGRAM_BOT_TOKEN no está configurado, todas las funciones son no-ops
 * y el servidor arranca normalmente sin errores.
 *
 * Configuración en .env:
 *   TELEGRAM_BOT_TOKEN=123456:ABC...  (obtener de @BotFather)
 *   TELEGRAM_CHAT_IDS=123456789,987654321  (obtener de @userinfobot)
 *
 * Comandos del bot:
 *   /start      — suscribirse a alertas automáticas
 *   /estado     — resumen actual del mercado
 *   /senales    — top 5 señales de compra
 *   /arbitraje  — oportunidades de arbitraje actuales
 *   /portfolio  — resumen del portfolio
 *   /alertas    — activar/desactivar notificaciones
 */

let bot           = null;
let botActive     = false;
let botUsername   = '';
let subscribedChats = new Set();

// ── Inicialización ────────────────────────────────────────────────────────────

/**
 * Inicializa el bot de Telegram si hay token configurado.
 * Llama a esta función una sola vez en el arranque del servidor.
 */
export async function initTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.log('[Telegram] Sin TELEGRAM_BOT_TOKEN — bot desactivado. Configurar en .env para habilitar.');
    return;
  }

  // Cargar chat IDs pre-configurados desde .env
  const preConfigured = (process.env.TELEGRAM_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  preConfigured.forEach(id => subscribedChats.add(id));

  try {
    // Importación dinámica para evitar error de arranque si telegraf no está instalado
    const { Telegraf } = await import('telegraf');
    bot = new Telegraf(token);

    // ── Comandos ─────────────────────────────────────────────────────────────

    bot.command('start', ctx => {
      const chatId = String(ctx.chat.id);
      subscribedChats.add(chatId);
      ctx.reply(
        `🚀 <b>InversorPro Bot activo</b>\n\n` +
        `Ahora recibirás alertas automáticas cuando:\n` +
        `• Se detecte una señal fuerte (score > 0.5)\n` +
        `• Haya arbitraje con ganancia > 1.5%\n` +
        `• Fear & Greed cruce zonas extremas\n` +
        `• Una ballena haga un movimiento grande\n\n` +
        `<b>Comandos disponibles:</b>\n` +
        `/estado — resumen del mercado\n` +
        `/senales — top señales de compra\n` +
        `/arbitraje — oportunidades actuales\n` +
        `/portfolio — tu portfolio\n` +
        `/alertas — activar/desactivar\n` +
        `/stop — darse de baja`,
        { parse_mode: 'HTML' }
      );
    });

    bot.command('stop', ctx => {
      subscribedChats.delete(String(ctx.chat.id));
      ctx.reply('👋 Dado de baja. Usá /start para volver a suscribirte.');
    });

    bot.command('estado', async ctx => {
      try {
        const { getDashboardData } = await import('../controllers/dashboardController.js');
        const data = await getDashboardData();
        const fg   = data.fearGreed;
        const mep  = (data.dollarRates ?? []).find(d => d.nombre?.toLowerCase().includes('mep'));
        const top  = data.topBuys?.[0];

        ctx.reply(
          `📊 <b>Estado del Mercado</b>\n\n` +
          `😨 Fear & Greed: <b>${fg?.value ?? '—'}</b> (${fg?.label ?? '—'})\n` +
          `💵 Dólar MEP: <b>$${mep?.venta?.toLocaleString('es-AR') ?? '—'}</b>\n` +
          `🏆 Merval: <b>${data.argentina?.mervalIndex?.value?.toLocaleString('es-AR') ?? '—'}</b>\n` +
          `🎯 Señales activas: <b>${data.signals?.length ?? 0}</b>\n` +
          (top ? `\n🟢 Mejor señal: <b>${top.symbol}</b> — Score: ${top.score}` : ''),
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        ctx.reply('❌ Error al obtener estado: ' + e.message);
      }
    });

    bot.command('senales', async ctx => {
      try {
        const { getDashboardData } = await import('../controllers/dashboardController.js');
        const data  = await getDashboardData();
        const buys  = (data.topBuys ?? []).slice(0, 5);
        if (!buys.length) return ctx.reply('Sin señales de compra activas en este momento.');

        const lista = buys.map((s, i) =>
          `${i + 1}. <b>${s.symbol}</b> (${s.confidence}) — Score: <code>${s.score > 0 ? '+' : ''}${s.score}</code>\n` +
          `   ${s.reason?.slice(0, 80)}...`
        ).join('\n\n');

        ctx.reply(`🟢 <b>Top Señales COMPRAR</b>\n\n${lista}`, { parse_mode: 'HTML' });
      } catch (e) {
        ctx.reply('❌ Error: ' + e.message);
      }
    });

    bot.command('arbitraje', async ctx => {
      try {
        const { getCryptoArbitrageOpportunities } = await import('./arbitrageService.js');
        const opps = await getCryptoArbitrageOpportunities();
        if (!opps.length) return ctx.reply('✅ Sin oportunidades de arbitraje viables en este momento.');

        const lista = opps.slice(0, 3).map(op =>
          `💰 <b>${op.coin}</b> | ${op.buyExchange} → ${op.sellExchange}\n` +
          `   Ganancia neta: <b>+${op.netProfitPct}%</b> | ~$${op.profitArs} ARS por $${(op.volumeArs/1000).toFixed(0)}K`
        ).join('\n\n');

        ctx.reply(`⚡ <b>Arbitraje Cripto</b>\n\n${lista}`, { parse_mode: 'HTML' });
      } catch (e) {
        ctx.reply('❌ Error: ' + e.message);
      }
    });

    bot.command('portfolio', async ctx => {
      try {
        const { dbAll } = await import('../database/db.js');
        const holdings = dbAll('portfolio');
        if (!holdings.length) return ctx.reply('Portfolio vacío. Agregá posiciones desde el dashboard.');

        const lista = holdings.slice(0, 8).map(h =>
          `• <b>${h.symbol}</b> ${h.amount} @ $${h.avg_price.toLocaleString('es-AR')} (${h.currency})`
        ).join('\n');

        ctx.reply(`💼 <b>Mi Portfolio</b> (${holdings.length} posiciones)\n\n${lista}`, { parse_mode: 'HTML' });
      } catch (e) {
        ctx.reply('❌ Error: ' + e.message);
      }
    });

    bot.command('alertas', ctx => {
      const chatId = String(ctx.chat.id);
      if (subscribedChats.has(chatId)) {
        subscribedChats.delete(chatId);
        ctx.reply('🔕 Alertas desactivadas. Usá /alertas de nuevo para reactivar.');
      } else {
        subscribedChats.add(chatId);
        ctx.reply('🔔 Alertas activadas. Recibirás notificaciones automáticas.');
      }
    });

    // Manejo de errores del bot
    bot.catch((err, ctx) => {
      console.error(`[Telegram] Error en update ${ctx.updateType}:`, err.message);
    });

    // Iniciar polling SIN await — bot.launch() resuelve solo cuando el bot se detiene
    bot.launch().catch(err => {
      console.error('[Telegram] Error en el loop de polling:', err.message);
      botActive = false;
    });
    botActive = true;
    // Obtener username de forma asíncrona sin bloquear el arranque
    bot.telegram.getMe()
      .then(me => {
        botUsername = me.username;
        console.log(`[Telegram] Bot @${botUsername} activo en modo polling. Chats suscritos: ${subscribedChats.size}`);
      })
      .catch(err => console.warn('[Telegram] No se pudo obtener username:', err.message));

    // Shutdown limpio
    process.once('SIGINT',  () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));

  } catch (error) {
    console.error('[Telegram] No se pudo iniciar el bot:', error.message);
    console.error('[Telegram] Verificar que TELEGRAM_BOT_TOKEN sea válido y telegraf esté instalado (npm install)');
    botActive = false;
  }
}

// ── Funciones de notificación (exportadas) ───────────────────────────────────

/** Envía una alerta cuando se detecta una señal de compra/venta fuerte */
export function notifyNewSignal(signal) {
  const { symbol, signal: sig, score, price, reason } = signal;
  const emoji = sig === 'COMPRAR' ? '🟢' : sig === 'VENDER' ? '🔴' : '🟡';
  sendToAllChats(
    `${emoji} <b>Señal ${sig}: ${symbol}</b>\n` +
    `Precio: $${Number(price).toLocaleString('es-AR')} | Score: ${score > 0 ? '+' : ''}${score}\n` +
    `<i>${(reason ?? '').slice(0, 100)}</i>`,
    { parse_mode: 'HTML' }
  );
}

/** Envía alerta cuando hay arbitraje con ganancia neta > umbral */
export function notifyArbitrage(opportunity) {
  const { coin, buyExchange, sellExchange, netProfitPct, profitArs, volumeArs } = opportunity;
  sendToAllChats(
    `💰 <b>Arbitraje: ${coin}</b>\n` +
    `Comprá en <b>${buyExchange}</b> → Vendé en <b>${sellExchange}</b>\n` +
    `Ganancia neta: <b>+${netProfitPct}%</b> (~$${profitArs} ARS por $${(volumeArs/1000).toFixed(0)}K)`,
    { parse_mode: 'HTML' }
  );
}

/** Envía alerta cuando se detecta un movimiento de ballena institucional */
export function notifyWhaleMove(move) {
  const emoji = move.action === 'BUY' ? '🟢' : move.action === 'SELL' ? '🔴' : '🟡';
  sendToAllChats(
    `🐋 <b>Ballena: ${move.investor}</b>\n` +
    `${emoji} ${move.action === 'BUY' ? 'Compra' : 'Vende'} <b>${move.asset}</b> — ${move.amountUsd ? '$' + (move.amountUsd/1e6).toFixed(0) + 'M' : ''}`,
    { parse_mode: 'HTML' }
  );
}

/** Envía alerta cuando Fear & Greed cruza umbral extremo */
export function notifyFearGreed(value, label) {
  const emoji = value < 25 ? '😱' : '🤑';
  sendToAllChats(
    `${emoji} <b>Fear & Greed: ${value} — ${label}</b>\n` +
    `${value < 25 ? 'Zona de miedo extremo: posible oportunidad de acumulación.' : 'Zona de codicia extrema: considerar reducir exposición.'}`,
    { parse_mode: 'HTML' }
  );
}

/** Envía alerta cuando el Merval cae más del umbral configurado */
export function notifyMervalDrop(changePct) {
  sendToAllChats(
    `📉 <b>Merval cayó ${Math.abs(changePct).toFixed(1)}%</b>\n` +
    `Considerar analizar CEDEARs y acciones locales con descuento.`,
    { parse_mode: 'HTML' }
  );
}

/**
 * Envía un mensaje a todos los chats suscritos.
 * No lanza excepción si el bot no está activo o el envío falla.
 * @param {string} text    - Texto del mensaje
 * @param {Object} options - Opciones de Telegram (parse_mode, etc.)
 */
export async function sendToAllChats(text, options = {}) {
  if (!bot || !botActive || subscribedChats.size === 0) return;
  for (const chatId of subscribedChats) {
    try {
      await bot.telegram.sendMessage(chatId, text, options);
    } catch (err) {
      console.warn(`[Telegram] Error enviando a ${chatId}: ${err.message}`);
      // Si el chat ya no existe o bloqueó el bot, removerlo
      if (err.description?.includes('chat not found') || err.description?.includes('blocked')) {
        subscribedChats.delete(chatId);
      }
    }
  }
}

/** Retorna el estado actual del bot para el endpoint /api/tools/telegram */
export function getBotStatus() {
  return {
    active:           botActive,
    botUsername:      botUsername || null,
    subscribedChats:  subscribedChats.size,
    tokenConfigured:  Boolean(process.env.TELEGRAM_BOT_TOKEN),
    setupInstructions: !process.env.TELEGRAM_BOT_TOKEN ? [
      '1. Hablar con @BotFather en Telegram → /newbot',
      '2. Copiar el token generado en .env como TELEGRAM_BOT_TOKEN',
      '3. Abrir t.me/userinfobot → copiar tu chat_id en TELEGRAM_CHAT_IDS',
      '4. Reiniciar el servidor',
    ] : null,
  };
}
