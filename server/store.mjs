// Persistencia simple en archivos JSON. No usamos una base de datos porque esta
// app es para un uso personal/simple: un solo usuario, sin necesidad de concurrencia
// real. Esto hace que instalar y correr la app sea trivial (sin infraestructura extra).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const TIENDANUBE_FILE = path.join(DATA_DIR, 'tiendanube.json');

export const DEFAULT_SETTINGS = {
  currency: 'ARS',
  // Porcentajes por defecto (como fracción, no como número entero) que se
  // aplican a todo producto que no tenga su propio "override".
  paymentFeePct: 0.06, // Comisión de medios de pago (Pago Nube / Mercado Pago).
  taxPct: 0, // IVA/IIBB/etc. Por defecto 0 (ej. monotributo). Ajustable.
  fixedCostPct: 0, // Prorrateo de costos fijos/publicidad.
  marginPct: 0.3, // Margen de ganancia deseado.
};

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(filePath, data) {
  await ensureDataDir();
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export async function getSettings() {
  const stored = await readJson(SETTINGS_FILE, null);
  return { ...DEFAULT_SETTINGS, ...(stored || {}) };
}

export async function saveSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await writeJson(SETTINGS_FILE, next);
  return next;
}

/**
 * "products.json" guarda dos cosas por id de producto:
 * - Costos/overrides para productos que vienen de Tienda Nube (por su id real).
 * - Productos "manuales" completos (cuando no hay tienda conectada, o para simular).
 *
 * Forma: { [productId]: { cost, shipping, overrides: {...pct}, manual?: {name, price} } }
 */
export async function getAllProductData() {
  return readJson(PRODUCTS_FILE, {});
}

export async function getProductData(id) {
  const all = await getAllProductData();
  return all[id] || null;
}

export async function saveProductData(id, data) {
  const all = await getAllProductData();
  all[id] = { ...(all[id] || {}), ...data };
  await writeJson(PRODUCTS_FILE, all);
  return all[id];
}

export async function deleteProductData(id) {
  const all = await getAllProductData();
  delete all[id];
  await writeJson(PRODUCTS_FILE, all);
}

function generateManualId() {
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createManualProduct({ name, price, cost, shipping }) {
  const id = generateManualId();
  await saveProductData(id, {
    cost: Number(cost) || 0,
    shipping: Number(shipping) || 0,
    overrides: {},
    manual: { name: name || 'Producto sin nombre', price: Number(price) || 0 },
  });
  return id;
}

// Credenciales de Tienda Nube (Store ID + Access Token). Se guardan acá, en
// data/tiendanube.json, en vez de requerir que edites el .env a mano y
// reinicies el servidor cada vez. Ese archivo está en .gitignore: nunca se
// commitea ni sale de tu máquina/servidor.
const DEFAULT_TIENDANUBE_CONFIG = { storeId: '', accessToken: '', userAgent: '' };

export async function getTiendaNubeConfig() {
  const stored = await readJson(TIENDANUBE_FILE, null);
  return { ...DEFAULT_TIENDANUBE_CONFIG, ...(stored || {}) };
}

export async function saveTiendaNubeConfig(partial) {
  const current = await getTiendaNubeConfig();
  // Si accessToken viene vacío/undefined, mantenemos el que ya estaba guardado
  // (para poder actualizar sólo el Store ID sin tener que volver a pegar el token).
  const next = {
    ...current,
    ...partial,
    accessToken: partial.accessToken ? partial.accessToken : current.accessToken,
  };
  await writeJson(TIENDANUBE_FILE, next);
  return next;
}
