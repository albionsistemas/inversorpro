/**
 * sentimentService.js — Análisis de sentimiento de mercado
 *
 * Fuentes de datos (sin API keys):
 *   - Reddit JSON API pública (r/CryptoCurrency, r/wallstreetbets, r/merval, r/bitcoin)
 *   - CryptoPanic API pública (noticias cripto con votos)
 *
 * Algoritmo:
 *   1. Tokenizar título + cuerpo del post
 *   2. Contar palabras clave positivas y negativas
 *   3. Ponderar por log(upvotes+1) para dar más peso a posts populares
 *   4. Normalizar a rango [-1, +1]
 *
 * Caché: 10 minutos (Reddit tiene límite de requests por IP)
 */

import axios from 'axios';

const CACHE_TTL_MS    = 10 * 60 * 1000;
const REDDIT_UA       = 'InversorPro/1.0 (dashboard financiero; github.com/inversorpro)';
const CRYPTOPANIC_URL = 'https://cryptopanic.com/api/v1/posts/?public=true&filter=hot';

const SUBREDDIT_URLS = [
  { subreddit: 'CryptoCurrency', url: 'https://www.reddit.com/r/CryptoCurrency/hot.json?limit=25' },
  { subreddit: 'wallstreetbets', url: 'https://www.reddit.com/r/wallstreetbets/hot.json?limit=25' },
  { subreddit: 'merval',         url: 'https://www.reddit.com/r/merval/hot.json?limit=25' },
  { subreddit: 'bitcoin',        url: 'https://www.reddit.com/r/bitcoin/hot.json?limit=25' },
];

// Vocabulario de sentimiento (ES + EN)
const POSITIVE = new Set([
  'moon','bull','buy','accumulate','rally','breakout','ath','gains','pump',
  'bullish','adoption','growth','surge','explode','hodl','long',
  'compra','sube','alcista','oportunidad','crecimiento','tendencia',
]);
const NEGATIVE = new Set([
  'bear','sell','dump','crash','rekt','fear','panic','short','bearish',
  'collapse','rug','scam','liquidation',
  'baja','cae','bajista','vende','crisis','quiebra','caída',
]);

// Caché en memoria
let cache = { data: null, timestamp: 0 };

// ── Utilidades internas ────────────────────────────────────────────────────────

function isCacheValid() {
  return cache.data !== null && (Date.now() - cache.timestamp) < CACHE_TTL_MS;
}

function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase().replace(/[^a-záéíóúüñ\s]/gi, ' ').split(/\s+/).filter(Boolean);
}

function rawScore(text) {
  let score = 0;
  for (const w of tokenize(text)) {
    if (POSITIVE.has(w)) score += 1;
    if (NEGATIVE.has(w)) score -= 1;
  }
  return score;
}

function weighted(score, upvotes) {
  return score * Math.log((upvotes ?? 0) + 1);
}

function normalize(scores) {
  if (!scores.length) return 0;
  const sum    = scores.reduce((a, s) => a + s, 0);
  const maxAbs = scores.reduce((a, s) => Math.max(a, Math.abs(s)), 0);
  if (maxAbs === 0) return 0;
  return Math.max(-1, Math.min(1, (sum / scores.length) / maxAbs));
}

function label(score) {
  if (score >  0.5)  return 'Muy Positivo';
  if (score >  0.2)  return 'Positivo';
  if (score >= -0.2) return 'Neutral';
  if (score >= -0.5) return 'Negativo';
  return 'Muy Negativo';
}

// Extrae tickers en mayúsculas (2-6 letras) del texto
function extractTickers(text) {
  const NOISE = new Set(['THE','AND','FOR','ARE','BUT','NOT','ALL','CAN','HAS','WAS',
    'ONE','OUR','OUT','GET','HOW','ITS','MAY','NOW','TOO','USE','USD','ATH','SEC',
    'IMF','CEO','LOL','RIP','WSB','PSA','FYI','NEW','TOP','BIG','ETF','NAV']);
  return (text.match(/\b[A-Z]{2,6}\b/g) || []).filter(t => !NOISE.has(t));
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchSubreddit(subreddit, url) {
  try {
    const r = await axios.get(url, { headers: { 'User-Agent': REDDIT_UA }, timeout: 8000 });
    return (r.data?.data?.children ?? []).map(c => ({
      title:   c.data?.title    ?? '',
      upvotes: c.data?.ups      ?? 0,
      text:    c.data?.selftext ?? '',
    }));
  } catch (e) {
    console.warn(`[SentimentService] r/${subreddit}: ${e.message}`);
    return [];
  }
}

async function fetchCryptoPanic() {
  try {
    const r = await axios.get(CRYPTOPANIC_URL, { timeout: 8000 });
    return (r.data?.results ?? []).map(p => ({
      title:      p.title ?? '',
      upvotes:    p.votes?.positive ?? 0,
      currencies: (p.currencies ?? []).map(c => c.code?.toUpperCase()).filter(Boolean),
    }));
  } catch (e) {
    console.warn(`[SentimentService] CryptoPanic: ${e.message}`);
    return [];
  }
}

// ── Procesamiento principal ───────────────────────────────────────────────────

async function fetchAndScore() {
  const results = await Promise.all(
    SUBREDDIT_URLS.map(({ subreddit, url }) =>
      fetchSubreddit(subreddit, url).then(posts => ({ subreddit, posts }))
    )
  );

  const bySubreddit = [];
  const allPosts    = [];

  for (const { subreddit, posts } of results) {
    if (!posts.length) continue;
    const scores = posts.map(p => weighted(rawScore(`${p.title} ${p.text}`), p.upvotes));
    const norm   = normalize(scores);
    bySubreddit.push({
      subreddit,
      score:   +norm.toFixed(4),
      label:   label(norm),
      topPost: posts[0]?.title ?? '',
    });
    posts.forEach(p => allPosts.push({ ...p, subreddit }));
  }

  const globalNorm = bySubreddit.length
    ? normalize(bySubreddit.map(s => s.score))
    : 0;

  return {
    overall: { score: +globalNorm.toFixed(4), label: label(globalNorm), postsAnalyzed: allPosts.length },
    bySubreddit,
    allPosts,
  };
}

// ── Funciones exportadas ──────────────────────────────────────────────────────

/**
 * Sentimiento agregado por subreddit.
 */
export async function getRedditSentiment() {
  if (isCacheValid()) {
    return { overall: cache.data.overall, bySubreddit: cache.data.bySubreddit, lastUpdated: cache.data.lastUpdated };
  }
  try {
    const result = await fetchAndScore();

    // Si Reddit devuelve 403 o bloquea todos los requests, caer a mock
    if (result.allPosts.length === 0) {
      console.warn('[SentimentService] Reddit bloqueó todos los requests (403). Usando datos demo.');
      const m = getMock();
      cache.data      = { ...m, lastUpdated: m.lastUpdated };
      cache.timestamp = Date.now();
      return { overall: m.overall, bySubreddit: m.bySubreddit, lastUpdated: m.lastUpdated, isMock: true };
    }

    cache.data      = { ...cache.data, ...result, lastUpdated: new Date().toISOString() };
    cache.timestamp = Date.now();
    return { overall: result.overall, bySubreddit: result.bySubreddit, lastUpdated: cache.data.lastUpdated };
  } catch (e) {
    console.error('[SentimentService]', e.message);
    const m = getMock();
    return { overall: m.overall, bySubreddit: m.bySubreddit, lastUpdated: m.lastUpdated, isMock: true };
  }
}

/**
 * Sentimiento filtrado por lista de símbolos de activos.
 * @param {string[]} symbols
 */
export async function getSentimentByAsset(symbols = []) {
  if (!symbols.length) return [];
  const syms = symbols.map(s => s.toUpperCase());

  // Asegurar que el caché esté poblado
  if (!isCacheValid()) await getRedditSentiment();

  const redditPosts  = cache.data?.allPosts ?? [];
  const cryptoPosts  = await fetchCryptoPanic();

  const map = {};
  syms.forEach(s => { map[s] = { scores: [], mentions: 0 }; });

  const processPost = (title, text, upvotes, taggedSyms = []) => {
    const full     = `${title} ${text}`.toUpperCase();
    const score    = weighted(rawScore(`${title} ${text}`), upvotes);
    const detected = [...new Set([...extractTickers(full), ...taggedSyms])];
    for (const sym of syms) {
      if (full.includes(sym) || detected.includes(sym)) {
        map[sym].mentions++;
        map[sym].scores.push(score);
      }
    }
  };

  redditPosts.forEach(p => processPost(p.title, p.text, p.upvotes));
  cryptoPosts.forEach(p => processPost(p.title, '', p.upvotes, p.currencies ?? []));

  return syms
    .map(sym => {
      const norm = normalize(map[sym].scores);
      return { symbol: sym, mentions: map[sym].mentions, score: +norm.toFixed(4), label: label(norm) };
    })
    .sort((a, b) => b.mentions - a.mentions);
}

/**
 * Resumen completo para el dashboard.
 */
export async function getSentimentSummary() {
  const defaultSymbols = [
    'BTC','ETH','SOL','ADA','BNB','XRP','AVAX','LINK','MATIC','DOGE',
    'ARB','OP','PEPE','SHIB','MEME','WIF',
  ];
  try {
    const reddit = await getRedditSentiment();

    // Si Reddit está bloqueado (403), retornar mock completo directamente
    if (reddit.isMock) {
      return getMock();
    }

    const byAsset  = await getSentimentByAsset(defaultSymbols);
    const trending = byAsset.filter(a => a.mentions > 0).slice(0, 3).map(a => a.symbol);
    return {
      overall:     reddit.overall,
      bySubreddit: reddit.bySubreddit,
      byAsset:     byAsset.filter(a => a.mentions > 0),
      trending,
      lastUpdated: reddit.lastUpdated,
    };
  } catch (e) {
    console.error('[SentimentService]', e.message);
    return getMock();
  }
}

// ── Mock de respaldo ──────────────────────────────────────────────────────────

function getMock() {
  return {
    overall:     { score: 0.31, label: 'Positivo', postsAnalyzed: 100 },
    bySubreddit: [
      { subreddit: 'CryptoCurrency', score:  0.45, label: 'Positivo',     topPost: 'Bitcoin breaks key resistance, analysts bullish' },
      { subreddit: 'wallstreetbets', score:  0.18, label: 'Neutral',      topPost: 'Options flow shows bullish bets on tech' },
      { subreddit: 'merval',         score:  0.22, label: 'Positivo',     topPost: 'Oportunidad de compra en panel líder' },
      { subreddit: 'bitcoin',        score:  0.62, label: 'Muy Positivo', topPost: 'Bitcoin adoption growing in Latin America' },
    ],
    byAsset: [
      { symbol: 'BTC',  mentions: 45, score: 0.60,  label: 'Muy Positivo' },
      { symbol: 'ETH',  mentions: 30, score: 0.35,  label: 'Positivo' },
      { symbol: 'SOL',  mentions: 18, score: 0.28,  label: 'Positivo' },
      { symbol: 'ADA',  mentions: 10, score: -0.15, label: 'Neutral' },
      { symbol: 'DOGE', mentions:  8, score:  0.10, label: 'Neutral' },
    ],
    trending:    ['BTC', 'ETH', 'SOL'],
    lastUpdated: new Date().toISOString(),
    isMock:      true,
  };
}
