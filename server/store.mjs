// Persistencia en Upstash Redis (base de datos online, plan gratis). Antes
// esto guardaba en archivos JSON locales, pero eso sólo funciona en un
// servidor de toda la vida: en Vercel (funciones serverless) no hay disco
// persistente entre requests, así que necesitábamos una base de datos real.
// Upstash se eligió porque:
// - Tiene un cliente HTTP (no necesita mantener una conexión abierta), ideal
//   para funciones serverless de vida corta.
// - Se integra directo desde el marketplace de Vercel: al conectarlo, las
//   variables UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN se cargan
//   solas, sin copiar nada a mano.
// - El modelo de datos de esta app son 4 "blobs" JSON (settings, productos,
//   gastos, config de Tienda Nube) — encaja perfecto con un key-value store,
//   sin necesidad de una base de datos relacional.
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

const SETTINGS_KEY = 'costos:settings';
const PRODUCTS_KEY = 'costos:products';
const TIENDANUBE_KEY = 'costos:tiendanube';
const EXPENSES_KEY = 'costos:expenses';
const ORDERS_KEY = 'costos:orders';

export const DEFAULT_SETTINGS = {
  currency: 'ARS',
  // Porcentajes por defecto (como fracción, no como número entero) que se
  // aplican a todo producto que no tenga su propio "override".
  paymentFeePct: 0.06, // Comisión de medios de pago (Pago Nube / Mercado Pago).
  taxPct: 0, // IVA/IIBB/etc. Por defecto 0 (ej. monotributo). Ajustable.
  marginPct: 0.3, // Margen de ganancia deseado.
  // Cuántas ventas estimás hacer por mes: se usa para repartir los gastos
  // fijos (ver "Gastos del negocio") entre esa cantidad de unidades.
  estimatedMonthlySales: 30,
};

async function readJson(key, fallback) {
  const raw = await redis.get(key);
  if (raw === null || raw === undefined) return fallback;
  // El cliente de Upstash a veces devuelve el valor ya parseado y a veces el
  // string tal cual, según la versión; contemplamos los dos casos.
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  return raw;
}

async function writeJson(key, data) {
  await redis.set(key, JSON.stringify(data));
}

export async function getSettings() {
  const stored = await readJson(SETTINGS_KEY, null);
  return { ...DEFAULT_SETTINGS, ...(stored || {}) };
}

export async function saveSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await writeJson(SETTINGS_KEY, next);
  return next;
}

/**
 * La clave "costos:products" guarda dos cosas por id de producto:
 * - Costos/overrides para productos que vienen de Tienda Nube (por su id real).
 * - Productos "manuales" completos (cuando no hay tienda conectada, o para simular).
 *
 * Forma: { [productId]: { cost, shipping, overrides: {...pct}, manual?: {name, price} } }
 */
export async function getAllProductData() {
  return readJson(PRODUCTS_KEY, {});
}

export async function getProductData(id) {
  const all = await getAllProductData();
  return all[id] || null;
}

export async function saveProductData(id, data) {
  const all = await getAllProductData();
  all[id] = { ...(all[id] || {}), ...data };
  await writeJson(PRODUCTS_KEY, all);
  return all[id];
}

export async function deleteProductData(id) {
  const all = await getAllProductData();
  delete all[id];
  await writeJson(PRODUCTS_KEY, all);
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

// Credenciales de Tienda Nube (Store ID + Access Token). Se guardan en la
// base de datos (clave "costos:tiendanube"), en vez de requerir que edites
// el .env a mano y reinicies el servidor cada vez.
// clientId/clientSecret son de una app creada en el Partner Portal
// (partners.tiendanube.com) y sirven para el flujo OAuth ("Conectar con
// Tienda Nube"), disponible en cualquier plan. storeId/accessToken son el
// resultado final de ese flujo (o, alternativamente, se pueden cargar a
// mano si tenés "Aplicaciones a medida", exclusivo de los planes
// Escala/Evolución).
const DEFAULT_TIENDANUBE_CONFIG = { storeId: '', accessToken: '', userAgent: '', clientId: '', clientSecret: '' };

export async function getTiendaNubeConfig() {
  const stored = await readJson(TIENDANUBE_KEY, null);
  return { ...DEFAULT_TIENDANUBE_CONFIG, ...(stored || {}) };
}

export async function saveTiendaNubeConfig(partial) {
  const current = await getTiendaNubeConfig();
  // Los campos "secretos" (accessToken, clientSecret) sólo se pisan si viene
  // un valor nuevo no vacío: así se puede actualizar el resto sin tener que
  // volver a pegarlos cada vez.
  const next = {
    ...current,
    ...partial,
    accessToken: partial.accessToken ? partial.accessToken : current.accessToken,
    clientSecret: partial.clientSecret ? partial.clientSecret : current.clientSecret,
  };
  await writeJson(TIENDANUBE_KEY, next);
  return next;
}

/**
 * Gastos del negocio (producción, packaging, publicidad, herramientas
 * digitales, etc.), guardados bajo la clave "costos:expenses".
 *
 * Forma: { [id]: { name, amount, type: 'fixed' | 'variable' } }
 * - "fixed": gasto mensual (alquiler, suscripciones, presupuesto de ads fijo).
 *   Se reparte entre las ventas estimadas del mes para saber cuánto le toca
 *   a cada unidad vendida.
 * - "variable": gasto por unidad que aplica a todas las ventas por igual
 *   (ej. una tarjetita que va en cada pedido), en pesos por unidad directo.
 */
export async function getAllExpenses() {
  return readJson(EXPENSES_KEY, {});
}

function generateExpenseId() {
  return `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createExpense({ name, amount, type }) {
  const all = await getAllExpenses();
  const id = generateExpenseId();
  all[id] = {
    name: name || 'Gasto sin nombre',
    amount: Number(amount) || 0,
    type: type === 'variable' ? 'variable' : 'fixed',
  };
  await writeJson(EXPENSES_KEY, all);
  return id;
}

export async function deleteExpense(id) {
  const all = await getAllExpenses();
  delete all[id];
  await writeJson(EXPENSES_KEY, all);
}

/**
 * Calcula, a partir de la lista de gastos y las ventas estimadas por mes,
 * cuánto le corresponde a CADA unidad vendida de gastos fijos y de gastos
 * variables generales. Se usa para sumarlo al costo base de cada producto.
 */
export function summarizeExpenses(expenses, estimatedMonthlySales) {
  const items = Object.values(expenses || {});
  const totalFixedMonthly = items.filter((e) => e.type === 'fixed').reduce((sum, e) => sum + (e.amount || 0), 0);
  const totalVariablePerUnit = items
    .filter((e) => e.type === 'variable')
    .reduce((sum, e) => sum + (e.amount || 0), 0);
  const sales = Number(estimatedMonthlySales) || 0;
  const fixedCostPerUnit = sales > 0 ? totalFixedMonthly / sales : 0;
  return { totalFixedMonthly, totalVariablePerUnit, fixedCostPerUnit };
}

/**
 * Pedidos al proveedor, guardados bajo la clave "costos:orders".
 *
 * A diferencia de los gastos fijos/variables (que son recurrentes y
 * previsibles), el envío de un pedido de mercadería es irregular: no sabés
 * cada cuánto vas a volver a pedir. Por eso no se prorratea contra ventas
 * estimadas como los gastos fijos — en cambio, cada pedido ya trae su propia
 * cantidad de unidades, y el envío se reparte directo entre esas unidades
 * (envío ÷ unidades = cuánto le toca a cada una).
 *
 * Sólo UN pedido puede estar "activo" a la vez — es el que efectivamente se
 * suma al costo de los productos (como si fuera un gasto variable más). Los
 * demás quedan guardados como historial, pero no afectan el cálculo.
 *
 * Forma: { [id]: { name, date, shippingCost, totalUnits, active } }
 */
export async function getAllOrders() {
  return readJson(ORDERS_KEY, {});
}

function generateOrderId() {
  return `order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createOrder({ name, date, shippingCost, totalUnits }) {
  const all = await getAllOrders();
  // El pedido nuevo pasa a ser el activo; se desactivan todos los demás.
  for (const order of Object.values(all)) {
    order.active = false;
  }
  const id = generateOrderId();
  all[id] = {
    name: name || 'Pedido sin nombre',
    date: date || '',
    shippingCost: Number(shippingCost) || 0,
    totalUnits: Number(totalUnits) || 0,
    active: true,
  };
  await writeJson(ORDERS_KEY, all);
  return id;
}

export async function setActiveOrder(id) {
  const all = await getAllOrders();
  if (!all[id]) return null;
  for (const [orderId, order] of Object.entries(all)) {
    order.active = orderId === id;
  }
  await writeJson(ORDERS_KEY, all);
  return all[id];
}

export async function deleteOrder(id) {
  const all = await getAllOrders();
  delete all[id];
  await writeJson(ORDERS_KEY, all);
}

/** Envío por unidad del pedido activo (0 si no hay ninguno marcado como activo). */
export function activeOrderShippingPerUnit(orders) {
  const active = Object.values(orders || {}).find((o) => o.active);
  if (!active || !active.totalUnits) return 0;
  return active.shippingCost / active.totalUnits;
}
