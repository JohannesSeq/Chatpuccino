# Aberración

Chat de roleplay con estilo de mensajería (WhatsApp), inspirado en [SillyTavern](https://github.com/SillyTavern/SillyTavern) y conectado a OpenRouter. Aplicación web React + servidor Node/Express, usable desde móvil y escritorio.

## Uso

```bash
npm install
npm run build
npm start          # http://localhost:3001 (también accesible desde tu red local)
```

Desarrollo con recarga en caliente: `npm run dev` (cliente en http://localhost:5173, API en 3001).

Variables opcionales: `PORT`, `HOST` (por defecto `0.0.0.0`), `DATA_DIR` (por defecto `./data`), `OPENROUTER_API_KEY`.

Primer arranque: **Ajustes → Conexión y modelo** → pega tu API key de OpenRouter, elige un modelo y listo.

> El servidor no tiene autenticación. Si lo expones fuera de tu red de confianza, ponlo detrás de un proxy con login/VPN: la API key de OpenRouter vive en `data/settings.json`.

## Datos (`data/`)

| Ruta | Contenido |
| --- | --- |
| `characters/<Nombre>.png` | Tarjetas de personaje: PNG con los metadatos `chara` (V2) y `ccv3` (V3), igual que SillyTavern |
| `chats/<Personaje>/<archivo>.jsonl` | Un archivo por chat; cada chat tiene su propia historia |
| `groups/<id>.json`, `group-chats/<id>/*.jsonl` | Grupos y sus chats |
| `personas/<id>.json` + `.png` | Personas (tu representación) |
| `lorebooks/<nombre>.json` | Lorebooks en formato World Info de SillyTavern |
| `settings.json` | API key, modelo y parámetros |

Puedes copiar tarjetas PNG, chats `.jsonl` y lorebooks desde una instalación de SillyTavern a estas carpetas (o importarlos desde la interfaz).

## Pruebas

`npm test` levanta el servidor contra un OpenRouter simulado y valida PNG, lorebooks, chats, streaming, swipes y grupos.
