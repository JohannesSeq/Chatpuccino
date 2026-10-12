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

## Presets y prompts de sistema

Estilo «Chat Completion» de SillyTavern (**Ajustes → Presets**). Cada preset es un JSON en `data/presets/` que guarda:
- **Muestreo:** temperatura, top P/K/A, min P, penalizaciones, tokens máximos y contexto.
- **Lista de prompts:** varios a la vez, cada uno con rol (sistema/usuario/asistente), contenido, activo/inactivo y orden. Los hay automáticos (descripción, personalidad, escenario, persona, lorebook antes/después, ejemplos y historial) y personalizados (los que tú añades). Un prompt personalizado puede ir en su posición de la lista o «en el chat» a cierta profundidad del historial.
- **Mensajes auxiliares y formatos:** inicio de chat, aviso de grupo, formato del lorebook/escenario/personalidad y unión de mensajes de sistema.

Puedes crear, duplicar, renombrar, eliminar, importar y exportar presets (se leen los JSON de SillyTavern; solo se usa el orden global de prompts, no el de cada personaje). El preset activo se cambia también desde el menú del chat, donde **«Ver prompt que se enviará»** muestra el prompt final con tokens estimados. La tarjeta del personaje puede reemplazar el prompt principal y las instrucciones posteriores al historial (`{{original}}` conserva el del preset).

## Importar chats

Botón ⬆ en la lista de chats: sube uno o varios `.jsonl` de SillyTavern y elige el personaje o grupo destino (se detecta por el nombre del personaje en el archivo). Cada archivo se añade como un chat nuevo.

## Apariencia

**Ajustes → Apariencia** (se aplica al instante y se guarda en el servidor, así que se ve igual en tus dispositivos):
- **Modo** claro, oscuro o automático (sigue al dispositivo).
- **Colores** de acento, de tus burbujas, de las del personaje y del fondo del chat, con paletas rápidas (Clásico, Café, Océano, Rosa, Bosque, Púrpura). Cada modo guarda sus propios colores y el texto de las burbujas se ajusta solo para mantener el contraste.
- **Fuentes** (de la interfaz y de los mensajes, por separado; incluye «otra fuente instalada») y **tamaños** de letra.
- **Burbujas:** opacidad de las tuyas y de las del personaje, desenfoque detrás de ellas y redondeo.
- **Fondo de pantalla:** una imagen detrás de los mensajes, con desenfoque y oscurecido/aclarado ajustables. Se guarda como `data/wallpaper.*` y la apariencia en `data/appearance.json` (ambos fuera de git).

## Variantes, ramas y grupos

- **Eliminar una variante:** en el último mensaje del personaje, el botón rojo 🗑 junto a «‹ 2/3 ›» borra solo la variante que estás viendo; el mensaje conserva las demás (la última no se puede quitar: borra el mensaje).
- **Ramificar:** toca un mensaje → *Ramificar*. Se crea un chat nuevo con una copia de la conversación hasta ese mensaje (inclusive), enlazado al original (`main_chat` en el `.jsonl`) y titulado «… (rama)». El original no cambia.
- **Impersonar:** el botón ✨ junto a *Enviar* pide al modelo que escriba un mensaje **como tú** (según tu persona y el contexto) y lo va escribiendo en la caja de texto; lo revisas, lo editas y lo envías tú. Si ya habías escrito algo, se usa como inicio. No se guarda nada en el chat hasta que envías, y puedes detenerlo con el mismo botón. La instrucción que se envía es editable en *Presets → Mensajes auxiliares* («Impersonar»).
- **Fijar chats:** ⋮ de un chat (en la lista o dentro del chat) → *Fijar chat*. Los fijados aparecen arriba, en su propia sección «Fijados» y con un icono de pin; dentro de cada sección siguen el orden por actividad reciente. Fijar no modifica el archivo del chat (se guarda en los ajustes), y la copia de un chat fijado no queda fijada.
- **Copiar chat:** menú ⋮ de un chat (en la lista o dentro del chat) → *Copiar chat*. Duplica la conversación completa como un chat independiente («… (copia)»); el original no cambia.
- **Tarjeta del personaje:** en un chat individual, toca el nombre del personaje en el encabezado; en un grupo, toca su nombre sobre cualquier mensaje. Se abre la tarjeta completa para verla y editarla (nombre, descripción, saludos, lorebook, imagen…) sin salir del chat. Al guardar, el cambio se aplica a las siguientes respuestas.
- **Persona activa:** botón en la esquina inferior izquierda de la lista de chats (avatar + nombre). Su menú lista tus personas (✓ la activa), permite **editar** la actual o crear una nueva sin salir de Chats. Si tienes un chat abierto, elegir una persona la aplica a ese chat y además la deja como predeterminada para los chats nuevos; sin chat abierto solo cambia la predeterminada.
- **Convertir en grupo:** menú del chat individual → *Convertir en grupo…*. Elige los demás personajes y el modo de respuesta; el chat pasa al grupo con todo su historial (o se copia, si marcas «Conservar también el chat original»).

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
| `presets/<nombre>.json` | Presets de generación y prompts (formato Chat Completion de SillyTavern) |
| `settings.json` | Conexiones (API keys, modelos, favoritos) y parámetros |
| `auth.json` | Usuario, hash de la contraseña y secreto de sesión |

Puedes copiar tarjetas PNG, chats `.jsonl` y lorebooks desde una instalación de SillyTavern a estas carpetas (o importarlos desde la interfaz).

## Pruebas

`npm test` levanta el servidor contra un OpenRouter simulado y valida PNG, lorebooks, chats, streaming, swipes y grupos.
