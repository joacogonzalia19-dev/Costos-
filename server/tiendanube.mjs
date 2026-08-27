// Cliente de la API de administración de Tienda Nube (api.tiendanube.com).
// Esto es INDEPENDIENTE del conector de Tienda Nube que usa Claude dentro de esta
// sesión: la app corre por su cuenta y necesita sus propias credenciales.
//
// Cómo conseguirlas (dejalo también en el README):
// 1. Entrá a tu panel de Tienda Nube > "Aplicaciones a medida" (menú lateral
//    del administrador) > "Crear aplicación a medida".
// 2. Elegí sólo los permisos que necesitás (lectura/modificación de
//    productos y precios) — evitar "Acceso completo" salvo que haga falta.
// 3. Al guardar, Tienda Nube genera el token automáticamente. Apretá
//    "Revelar" y "Copiar token": sólo se muestra completo esa vez, después
//    queda enmascarado para siempre (si se pierde, hay que revocarlo y
//    crear uno nuevo).
// 4. Cargá el Store ID (el número de tu tienda, visible en la URL del
//    panel de administración) y el token desde la app misma (sección
//    "Conectar tienda"), o como respaldo, en el archivo .env como
//    TN_STORE_ID / TN_ACCESS_TOKEN.
//
// Formato de la API según la documentación oficial (dev.tiendanube.com /
// tiendanube.github.io/api-documentation): URL versionada por fecha, header
// "Authorization: Bearer <token>", y un "User-Agent" obligatorio que
// identifique la app y un contacto — sin él, la API responde 400.
import * as store from './store.mjs';

const API_BASE = 'https://api.tiendanube.com/2025-03';

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
