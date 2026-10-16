# Proxy anti-CORS de Tinta (Cloudflare Worker)

La PWA publicada en GitHub Pages **no puede llamar directo** a
`api.mangadex.org`: ese API solo envía `Access-Control-Allow-Origin` a
orígenes `localhost`. Este Worker hace de intermediario: recibe
`?u=<url destino>`, valida el dominio contra una allowlist estricta y
devuelve la respuesta con CORS abierto. Sin cuentas, sin claves, sin
estado. Plan gratuito de Cloudflare: 100,000 peticiones/día.

## Despliegue (5 minutos, una sola vez)

### Opción A — desde el panel de Cloudflare (sin instalar nada)

1. Entra a [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Worker**.
2. Nombre: `tinta-proxy` → **Deploy** (crea el Worker de ejemplo).
3. **Edit code**: borra el contenido y pega el de [`worker.js`](worker.js) de esta carpeta. **Deploy**.
4. Copia la URL resultante (`https://tinta-proxy.<tu-cuenta>.workers.dev`).
5. En Tinta: **Ajustes** → pega la URL en “URL del proxy” → Guardar.

### Opción B — con Wrangler (CLI)

```bash
npm install -g wrangler
cd proxy
wrangler login
wrangler deploy
```

La URL queda en la salida del comando; pégala en Ajustes de la app.

## Verificación rápida

```bash
curl "https://tinta-proxy.<tu-cuenta>.workers.dev/?u=https%3A%2F%2Fapi.mangadex.org%2Fmanga%3Flimit%3D1" -i | grep -i access-control
# Debe responder: Access-Control-Allow-Origin: *
```

## Seguridad

- **Allowlist cerrada**: solo `api.mangadex.org`, `uploads.mangadex.org`,
  `*.mangadex.network`, `weebcentral.com` y el catálogo de fuentes.
  No es un proxy abierto: cualquier otro destino recibe 403.
- Solo GET/POST, solo HTTPS. No reenvía cookies ni cabeceras de
  autenticación del visitante; el `User-Agent` por defecto es el de
  Aidoku (las fuentes lo esperan así).
