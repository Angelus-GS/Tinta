// Tinta — proxy anti-CORS (Cloudflare Worker)
//
// Por que existe: api.mangadex.org solo manda Access-Control-Allow-Origin a
// origenes localhost y Weeb Central no manda CORS util. La PWA publicada
// necesita un intermediario del mismo "lado" que emita CORS correcto.
//
// Uso desde la app:  GET/POST  https://<este-worker>/?u=<url destino codificada>
// Seguridad: allowlist estricta de dominios (nada de proxy abierto), solo
// GET/POST, sin cookies ni cabeceras de autenticacion del visitante.

const ALLOWLIST = [
  'api.mangadex.org',
  'uploads.mangadex.org',
  'mangadex.network',      // cubre *.mangadex.network (servidores at-home)
  'weebcentral.com',
  'www.weebcentral.com',
  'temp.compsci88.com',    // CDN de portadas y paginas de Weeb Central
  'planeptune.us',         // CDN de grupos de scanlation en Weeb Central (p. ej. scans-hot)
  'aidoku-community.github.io',
];

const FORWARD_REQUEST_HEADERS = ['accept', 'accept-language', 'content-type', 'range'];
// UA por defecto: uno de navegador real. El de Aidoku ("Aidoku/1 CFNetwork…")
// lo desafia Cloudflare al salir desde un Worker (403 en Weeb Central), y un
// UA de navegador pasa sin friccion en todos los destinos actuales. Un
// cliente puede seguir forzando otro con la cabecera x-tinta-ua.
const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function allowed(hostname) {
  return ALLOWLIST.some((d) => hostname === d || hostname.endsWith(`.${d}`));
}

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    // X-Tinta-Ua es imprescindible: si no se anuncia, el navegador bloquea
    // tras el preflight cualquier peticion del host que la lleve (Fase 2).
    'Access-Control-Allow-Headers': 'Content-Type, Range, X-Tinta-Ua',
    'Access-Control-Expose-Headers': '*',
    ...extra,
  };
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response('Metodo no permitido', { status: 405, headers: corsHeaders() });
    }
    const target = new URL(request.url).searchParams.get('u');
    if (!target) {
      return new Response('Falta el parametro ?u=<url>', { status: 400, headers: corsHeaders() });
    }
    let url;
    try {
      url = new URL(target);
    } catch {
      return new Response('URL destino invalida', { status: 400, headers: corsHeaders() });
    }
    if (url.protocol !== 'https:' || !allowed(url.hostname)) {
      return new Response(`Destino no permitido: ${url.hostname}`, { status: 403, headers: corsHeaders() });
    }

    const headers = new Headers();
    for (const h of FORWARD_REQUEST_HEADERS) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    headers.set('User-Agent', request.headers.get('x-tinta-ua') || DEFAULT_UA);

    const init = { method: request.method, headers, redirect: 'follow' };
    if (request.method === 'POST') init.body = await request.arrayBuffer();

    let upstream;
    try {
      upstream = await fetch(url.toString(), init);
    } catch (err) {
      return new Response(`Error al contactar el destino: ${err.message}`, { status: 502, headers: corsHeaders() });
    }

    const outHeaders = new Headers();
    // OJO: nunca reenviar content-length (ni content-encoding) del origen.
    // El runtime puede entregar el cuerpo descomprimido y la longitud
    // original lo truncaba en el cliente (las busquedas llegaban cortadas
    // y Tinta las leia como "sin resultados"). Que el runtime ponga la suya.
    for (const h of ['content-type', 'cache-control', 'etag']) {
      const v = upstream.headers.get(h);
      if (v) outHeaders.set(h, v);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: corsHeaders(Object.fromEntries(outHeaders)),
    });
  },
};
