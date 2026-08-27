// Cliente de la API de administración de Tienda Nube (api.tiendanube.com).
// Esto es INDEPENDIENTE del conector de Tienda Nube que usa Claude dentro de esta
// sesión: la app corre por su cuenta y necesita sus propias credenciales.
//
// Hay DOS formas de conseguir Store ID + Access Token (ver README):
//
// A) "Aplicaciones a medida" (menú del panel) — sólo disponible en los
//    planes Escala/Evolución. Da el token directo, sin más trámite.
//
// B) OAuth vía Partner Portal (partners.tiendanube.com) — funciona en
//    cualquier plan. Hace falta una cuenta de Partner gratuita y una app
//    creada ahí (da un Client ID + Client Secret), y esta app expone las
//    rutas /oauth/start y /oauth/callback para completar el intercambio
//    automáticamente y guardar storeId + accessToken.
//
// Formato de la API según la documentación oficial (dev.tiendanube.com /
// tiendanube.github.io/api-documentation): URL versionada por fecha, header
// "Authorization: Bearer <token>", y un "User-Agent" obligatorio que
// identifique la app y un contacto — sin él, la API responde 400.
import * as store from './store.mjs';

const API_BASE = 'https://api.tiendanube.com/2025-03';
const AUTHORIZE_TOKEN_URL = 'https://www.tiendanube.com/apps/authorize/token';

async function getConfig() {
  const saved = await store.getTiendaNubeConfig();
  return {
    storeId: saved.storeId || process.env.TN_STORE_ID || '',
    accessToken: saved.accessToken || process.env.TN_ACCESS_TOKEN || '',
    userAgent: saved.userAgent || process.env.TN_USER_AGENT || 'Costos- App (sin contacto configurado)',
  };
}

export async function isConfigured() {
  const { storeId, accessToken } = await getConfig();
  return Boolean(storeId && accessToken);
}

/** Estado de configuración sin exponer el access token (para mostrar en la UI). */
export async function getPublicConfig() {
  const { storeId, accessToken, userAgent } = await getConfig();
  return { storeId, userAgent, hasToken: Boolean(accessToken) };
}

async function getOAuthAppConfig() {
  const saved = await store.getTiendaNubeConfig();
  return {
    clientId: saved.clientId || process.env.TN_CLIENT_ID || '',
    clientSecret: saved.clientSecret || process.env.TN_CLIENT_SECRET || '',
  };
}

/** Estado de la app OAuth (Partner Portal), sin exponer el client secret. */
export async function getOAuthPublicConfig() {
  const { clientId, clientSecret } = await getOAuthAppConfig();
  return { clientId, hasClientSecret: Boolean(clientSecret) };
}

/** URL a la que hay que mandar al usuario para autorizar la instalación. */
export async function buildAuthorizeUrl() {
  const { clientId } = await getOAuthAppConfig();
  if (!clientId) {
    throw new Error('Falta el Client ID de la app (Partner Portal).');
  }
  return `https://www.tiendanube.com/apps/${clientId}/authorize`;
}

/**
 * Intercambia el "code" recibido en /oauth/callback por un access_token
 * definitivo, y de paso guarda storeId + accessToken. Devuelve el
 * resultado guardado (sin el token, para poder mostrarlo en la UI).
 */
export async function completeOAuth(code) {
  const { clientId, clientSecret } = await getOAuthAppConfig();
  if (!clientId || !clientSecret) {
    throw new Error('Falta el Client ID/Client Secret de la app (Partner Portal).');
  }

  const res = await fetch(AUTHORIZE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`No se pudo intercambiar el código por un token (${res.status}): ${body}`);
  }

  const data = await res.json();
  // OJO: este endpoint responde 200 OK incluso cuando las credenciales son
  // inválidas o el code expiró/no es válido — el error viene en el body
  // (ej. {"error":"invalid_client","error_description":"..."}), no en el
  // status HTTP. Hay que revisarlo explícitamente antes de asumir éxito.
  if (data.error || !data.access_token || !data.user_id) {
    throw new Error(data.error_description || data.error || 'Tienda Nube no devolvió un access_token válido.');
  }

  await store.saveTiendaNubeConfig({
    storeId: String(data.user_id),
    accessToken: data.access_token,
  });

  return { storeId: String(data.user_id), scope: data.scope };
}

async function tnFetch(pathname, options = {}) {
  const { storeId, accessToken, userAgent } = await getConfig();
  if (!storeId || !accessToken) {
    throw new Error('Tienda Nube no está configurada (faltan Store ID / Access Token).');
  }

  const url = `${API_BASE}/${storeId}${pathname}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Tienda Nube API error ${res.status} en ${pathname}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/**
 * Trae todos los productos de la tienda (paginado internamente).
 * Devuelve una forma simplificada: [{ id, name, variants: [{ id, price }] }]
 */
export async function listProducts({ maxProducts = 200 } = {}) {
  const results = [];
  let page = 1;
  const perPage = 50;

  while (results.length < maxProducts) {
    const batch = await tnFetch(`/products?page=${page}&per_page=${perPage}`);
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const product of batch) {
      results.push({
        id: String(product.id),
        name: product.name?.es || product.name?.pt || Object.values(product.name || {})[0] || `Producto ${product.id}`,
        variants: (product.variants || []).map((v) => ({
          id: String(v.id),
          price: v.price === null || v.price === undefined ? null : Number(v.price),
        })),
      });
    }

    if (batch.length < perPage) break;
    page += 1;
  }

  return results.slice(0, maxProducts);
}

/** Actualiza el precio de venta de una variante puntual. */
export async function updateVariantPrice(productId, variantId, price) {
  return tnFetch(`/products/${productId}/variants/${variantId}`, {
    method: 'PUT',
    body: JSON.stringify({ price: Number(price).toFixed(2) }),
  });
}

/**
 * Prueba las credenciales guardadas contra la API real, sin modificar nada:
 * pide los datos de la tienda (endpoint de sólo lectura). Se usa desde el
 * botón "Probar conexión" en la interfaz.
 */
export async function testConnection() {
  const info = await tnFetch('/store');
  const name = info?.name?.es || info?.name?.pt || Object.values(info?.name || {})[0] || null;
  return { storeName: name, url: info?.url || null };
}
