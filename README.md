# InversorPro 📊

Dashboard financiero modular para inversores en Crypto, Bolsa US y Mercado Argentino.

## Características

- **Crypto** — Precios en tiempo real (CoinGecko), Fear & Greed Index
- **US Stocks** — 10 acciones del S&P 500 con señales de compra/venta
- **Argentina** — Dólar MEP/CCL/Blue (live), Merval y CEDEARs
- **Ballenas** — Movimientos institucionales (Buffett, ARK, Dalio, etc.)
- **Arbitraje** — Oportunidades entre exchanges argentinos (Criptoya) + MEP
- **Sentimiento** — Análisis de Reddit/CryptoPanic por activo
- **Backtest** — Simulador de estrategias con GBM + métricas (Sharpe, Drawdown, Win Rate)
- **Alertas Telegram** — Notificaciones automáticas de señales y arbitraje
- **Portfolio** — Seguimiento de posiciones con P&L

## Stack

- **Backend:** Node.js 24+ (ES Modules), Express 4
- **Frontend:** Tailwind CSS (CDN), dark theme, mobile-first
- **Base de datos:** JSON file store (sin dependencias nativas)
- **APIs:** CoinGecko, dolarapi.com, Criptoya (gratuitas, sin auth)

## Instalación

```bash
git clone https://github.com/albionsistemas/inversorpro.git
cd inversorpro
npm install
cp .env.example .env
npm start
```

Abrí `http://localhost:3000`

## Configuración opcional (.env)

```env
# Bot de Telegram (opcional)
TELEGRAM_BOT_TOKEN=123456:ABC...   # Obtener de @BotFather
TELEGRAM_CHAT_IDS=123456789        # Obtener de @userinfobot

# Umbrales de alertas
ARBITRAGE_ALERT_THRESHOLD=1.5
SIGNAL_ALERT_THRESHOLD=0.5
FEAR_GREED_ALERT_LOW=20
FEAR_GREED_ALERT_HIGH=80
```

## APIs utilizadas

| API | Estado | Descripción |
|-----|--------|-------------|
| CoinGecko | ✅ Live | Precios crypto, Fear & Greed |
| dolarapi.com | ✅ Live | MEP, CCL, Blue, Oficial |
| Criptoya | ✅ Live | Arbitraje entre exchanges ARS |
| Yahoo Finance | ⚠ Mock | API unofficial deprecada |
| Reddit JSON | ⚠ Mock | Bloqueado sin OAuth desde 2023 |
| Telegram | ✅ Opcional | Requiere token en .env |

## Estructura del proyecto

```
├── server.js                  # Servidor Express
├── public/
│   ├── index.html             # SPA con 9 tabs
│   └── js/dashboard.js        # Frontend
└── src/
    ├── controllers/           # Lógica de endpoints
    ├── routes/                # Rutas Express
    ├── services/              # Servicios por módulo
    └── database/db.js         # JSON store
```

## Actualizar desde otra PC

```bash
git pull
npm install
npm start
```
