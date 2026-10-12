# Chatpuccino

Chat de roleplay con estilo de mensajería (WhatsApp), inspirado en [SillyTavern](https://github.com/SillyTavern/SillyTavern) y conectado a OpenRouter. Aplicación web React + servidor Node/Express, usable desde móvil y escritorio.

## Uso

```bash
npm install
npm run build
npm start          # http://localhost:3001 (también accesible desde tu red local)
```

Desarrollo con recarga en caliente: `npm run dev` (cliente en http://localhost:5173, API en 3001).

Primer arranque: entra con **`admin` / `Admin`** y cambia la contraseña en **Ajustes → Seguridad**. Luego, en **Ajustes → Conexión y modelo**, añade una conexión (OpenRouter con tu API key, o un servidor local compatible con OpenAI como LM Studio u Ollama) y elige un modelo.

## Conexiones y modelos

- Puedes guardar varias conexiones (cuentas de OpenRouter y/o servidores locales) y cambiar de una a otra; la activa se usa para generar.
- Servidor local: URL de la API compatible con OpenAI, p. ej. `http://localhost:1234/v1` (LM Studio) o `http://localhost:11434/v1` (Ollama). La URL se abre desde la máquina que ejecuta Chatpuccino.
- Cada conexión tiene sus **modelos favoritos** (estrella); también aparecen en el menú del chat → *Modelo* para cambiar rápido.

## Importar chats

Botón ⬆ en la lista de chats: sube uno o varios `.jsonl` de SillyTavern y elige el personaje o grupo destino (se detecta por el nombre del personaje en el archivo). Cada archivo se añade como un chat nuevo.

## Seguridad

- Inicio de sesión con cookie firmada (30 días), contraseña con scrypt y bloqueo progresivo tras 5 intentos fallidos.
- Desde **Ajustes → Seguridad** puedes cambiar usuario/contraseña, cerrar sesiones en todos los dispositivos o desactivar el login (no recomendado fuera de un equipo de confianza).
- Los datos de acceso están en `data/auth.json`. Si olvidas la contraseña, borra ese archivo y reinicia: vuelve `admin` / `Admin`.
- Usa HTTPS (proxy inverso) si accedes desde fuera de tu red local: la cookie se marca `Secure` automáticamente tras un proxy que envíe `X-Forwarded-Proto: https`.

Variables opcionales: `PORT`, `HOST` (por defecto `0.0.0.0`), `DATA_DIR` (por defecto `./data`), `OPENROUTER_API_KEY` (solo se usa para crear la conexión inicial).

## Datos (`data/`)

| Ruta | Contenido |
| --- | --- |
| `characters/<Nombre>.png` | Tarjetas de personaje: PNG con los metadatos `chara` (V2) y `ccv3` (V3), igual que SillyTavern |
| `chats/<Personaje>/<archivo>.jsonl` | Un archivo por chat; cada chat tiene su propia historia |
| `groups/<id>.json`, `group-chats/<id>/*.jsonl` | Grupos y sus chats |
| `personas/<id>.json` + `.png` | Personas (tu representación) |
| `lorebooks/<nombre>.json` | Lorebooks en formato World Info de SillyTavern |
| `settings.json` | Conexiones (API keys, modelos, favoritos) y parámetros |
| `auth.json` | Usuario, hash de la contraseña y secreto de sesión |

Puedes copiar tarjetas PNG, chats `.jsonl` y lorebooks desde una instalación de SillyTavern a estas carpetas (o importarlos desde la interfaz).

## Pruebas

`npm test` levanta el servidor contra un OpenRouter simulado y valida PNG, lorebooks, chats, streaming, swipes y grupos.
