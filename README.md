# BabyCam Monitor

BabyCam es una aplicacion web de monitoreo en tiempo real (audio + video) para usar una webcam como baby monitor personal.

Incluye una interfaz Host para la computadora con camara y una interfaz Viewer optimizada para mobile, con enlace compartible por copia, Web Share y QR.

## Caracteristicas

- Streaming en vivo con `WebRTC` (baja latencia).
- Servicio de senializacion con `Node.js + Express + Socket.IO`.
- Seleccion de multiples camaras y microfonos.
- Fallback robusto de captura:
  - prioriza video,
  - intenta audio cuando esta disponible,
  - informa errores claros de permisos/dispositivos.
- UI mobile-first estilo glass iOS para experiencia de visualizacion en celular.
- Link de viewer facil de compartir:
  - copiar portapapeles,
  - Web Share API,
  - codigo QR.

## Arquitectura

- `server.js`
  - servidor HTTP,
  - Socket.IO para salas (`host`/`viewer`) y senializacion WebRTC,
  - endpoint de configuracion ICE (`/api/config`),
  - endpoint para QR (`/api/qr`).
- `public/host.html` + `public/host.js`
  - preview local,
  - seleccion de dispositivos,
  - control de inicio/parada de transmision.
- `public/viewer.html` + `public/viewer.js`
  - recepcion de stream remoto,
  - controles mobile (mute, fullscreen, retry).

## Requisitos

- Node.js `18+`
- Navegador moderno con soporte WebRTC
- Para acceso remoto estable: `HTTPS` + servidor `TURN`

## Instalacion

```bash
npm install
```

## Ejecucion local

```bash
npm start
```

URLs principales:

- Host: `http://localhost:8787/host`
- Viewer: `http://localhost:8787/watch/<sala>`

## Variables de entorno

- `PORT` (default: `8787`)
- `HOST` (default: `0.0.0.0`)
- `PUBLIC_BASE_URL`
  - URL publica base para generar links de share.
  - Ejemplo: `https://babycam.tudominio.com`
- `ICE_SERVERS`
  - JSON de STUN/TURN para WebRTC.

Ejemplo:

```bash
ICE_SERVERS=[{"urls":["stun:stun.l.google.com:19302"]},{"urls":["turn:turn.tudominio.com:3478"],"username":"user","credential":"pass"}]
```

## Publicacion por internet

1. Exponer el servidor via HTTPS (Cloudflare Tunnel, reverse proxy o VPS).
2. Definir `PUBLIC_BASE_URL` con tu dominio publico.
3. Configurar `ICE_SERVERS` con TURN para conexiones entre redes distintas.

## Uso rapido

1. Abrir `/host` en la PC con webcam.
2. Seleccionar camara/microfono.
3. Iniciar transmision.
4. Compartir el link del viewer.
5. Abrir el link en otro celular/dispositivo.

## Troubleshooting

- No aparece imagen:
  - usar `localhost` o `https` (evitar contexto inseguro),
  - habilitar permisos de camara en el navegador,
  - cerrar apps que esten ocupando la camara (Meet, Zoom, OBS, Teams).
- No hay audio en mobile:
  - tocar `Tocar para activar audio`,
  - revisar permisos de microfono en host.
- Conexion remota inestable:
  - verificar TURN en `ICE_SERVERS`.

## Licencia

MIT
