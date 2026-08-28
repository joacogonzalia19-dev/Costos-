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

export const DEFAULT_SETTINGS = {
  currency: 'ARS',
  // Porcentajes por defecto (como fracción, no como número entero) que se
  // aplican a todo producto que no tenga su propio "override".
  paymentFeePct: 0.06, // Comisión de medios de pago.
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
 * "products.json" guarda todos tus productos cargados a mano:
 * { [id]: { name, cost, shipping, overrides: {...pct} } }
 */
export async function getAllProducts() {
  return readJson(PRODUCTS_FILE, {});
}

export async function getProduct(id) {
  const all = await getAllProducts();
  return all[id] || null;
}

function generateId() {
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createProduct({ name, cost, shipping }) {
  const all = await getAllProducts();
  const id = generateId();
  all[id] = {
    name: name || 'Producto sin nombre',
    cost: Number(cost) || 0,
    shipping: Number(shipping) || 0,
    overrides: {},
  };
  await writeJson(PRODUCTS_FILE, all);
  return id;
}

export async function updateProduct(id, { name, cost, shipping, overrides }) {
  const all = await getAllProducts();
  const current = all[id];
  if (!current) return null;
  all[id] = {
    ...current,
    name: name ?? current.name,
    cost: cost !== undefined ? Number(cost) || 0 : current.cost,
    shipping: shipping !== undefined ? Number(shipping) || 0 : current.shipping,
    overrides: overrides ?? current.overrides,
  };
  await writeJson(PRODUCTS_FILE, all);
  return all[id];
}

export async function deleteProduct(id) {
  const all = await getAllProducts();
  delete all[id];
  await writeJson(PRODUCTS_FILE, all);
}
