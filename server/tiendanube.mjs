// Cliente de la API de administración de Tienda Nube (api.tiendanube.com).
// Esto es INDEPENDIENTE del conector de Tienda Nube que usa Claude dentro de esta
// sesión: la app corre por su cuenta y necesita sus propias credenciales.
//
// Cómo conseguirlas (dejalo también en el README):
// 1. Entrá a tu panel de Tienda Nube > "Configuración" > "Mis aplicaciones" (o
//    https://www.tiendanube.com/apps si tenés cuenta de partner) y creá una
//    "aplicación privada" para tu propia tienda.
// 2. Tiendanube te da un Store ID (el número de tu tienda) y un Access Token.
// 3. Cargalos en el archivo .env como TN_STORE_ID y TN_ACCESS_TOKEN.
//
// La API requiere además un header "User-Agent" que identifique la app y un
// contacto (lo pide Tienda Nube para poder contactarte si hay un problema).

const API_BASE = 'https://api.tiendanube.com/v1';

function getConfig() {
  const storeId = process.env.TN_STORE_ID;
  const accessToken = process.env.TN_ACCESS_TOKEN;
  const userAgent = process.env.TN_USER_AGENT || 'Costos- App (sin contacto configurado)';
  return { storeId, accessToken, userAgent };
}

export function isConfigured() {
  const { storeId, accessToken } = getConfig();
  return Boolean(storeId && accessToken);
}

async function tnFetch(pathname, options = {}) {
  const { storeId, accessToken, userAgent } = getConfig();
  if (!storeId || !accessToken) {
    throw new Error('Tienda Nube no está configurada (faltan TN_STORE_ID / TN_ACCESS_TOKEN en .env).');
  }

  const url = `${API_BASE}/${storeId}${pathname}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authentication: `bearer ${accessToken}`,
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
