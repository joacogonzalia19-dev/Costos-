import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

import {
  calculateSuggestedPrice,
  calculateBreakdownForPrice,
  calculateComboRow,
  calculateAdSpendMonthRow,
} from '../shared/pricing.mjs';
import * as store from './store.mjs';
import * as tiendanube from './tiendanube.mjs';
import { requireAuth, checkPassword, issueSessionCookie, clearSessionCookie } from './auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// Login: una sola contraseña compartida (ver server/auth.mjs) para que la
// app pueda vivir en un link público sin que cualquiera vea tus costos o
// toque precios reales en tu Tienda Nube. Va ANTES que todo lo demás.
app.post('/api/login', (req, res) => {
  try {
    if (checkPassword(req.body?.password)) {
      issueSessionCookie(res);
      return res.json({ ok: true });
    }
    res.status(401).json({ ok: false, error: 'Contraseña incorrecta.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Sirve el frontend estático y el módulo de cálculo compartido (para que el
// navegador pueda hacer `import ... from '/shared/pricing.mjs'` y usar
// exactamente la misma lógica que el backend). Esto va ANTES del login a
// propósito: ni el HTML/CSS/JS ni la fórmula de cálculo tienen datos tuyos
// (todo lo real vive detrás de las rutas /api/*, que sí exigen sesión más
// abajo), y dejarlos afuera del login evita un problema real de navegadores:
// las peticiones que dispara un `import` de JS a veces no mandan la cookie
// de sesión, aunque la carga de la página sí la mande — con esto no importa.
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

app.use(requireAuth);

function effectiveInputs(settings, productData, expenseSummary) {
  const overrides = productData?.overrides || {};
  return {
    cost: productData?.cost ?? 0,
    shipping: productData?.shipping ?? 0,
    fixedCostPerUnit: expenseSummary.fixedCostPerUnit,
    variableCostPerUnit: expenseSummary.totalVariablePerUnit,
    paymentFeePct: overrides.paymentFeePct ?? settings.paymentFeePct,
    taxPct: overrides.taxPct ?? settings.taxPct,
    marginPct: overrides.marginPct ?? settings.marginPct,
  };
}

async function getExpenseSummary() {
  const settings = await store.getSettings();
  const expenses = await store.getAllExpenses();
  const orders = await store.getAllOrders();
  const base = store.summarizeExpenses(expenses, settings.estimatedMonthlySales);
  const supplierShippingPerUnit = store.activeOrderShippingPerUnit(orders);
  // El envío del pedido activo y los gastos "por pedido" se suman al mismo
  // "pozo" que los gastos variables generales: para la venta de UN producto
  // individual, un pedido ES una unidad, así que se suman igual que
  // cualquier otro gasto variable.
  return {
    ...base,
    supplierShippingPerUnit,
    totalVariablePerUnit: base.totalVariablePerUnit + base.totalVariablePerOrder + supplierShippingPerUnit,
  };
}

/** Busca el producto manual "Cuadro Negro <medida>" cargado en Productos (match exacto, sin mayúsculas/espacios de más). */
function findCuadroNegroProduct(allProductData, size) {
  const target = `cuadro negro ${size}`.toLowerCase();
  for (const data of Object.values(allProductData)) {
    if (data.manual && (data.manual.name || '').trim().toLowerCase() === target) {
      return { cost: Number(data.cost) || 0 };
    }
  }
  return null;
}

app.get('/api/tiendanube/status', async (req, res) => {
  res.json({ configured: await tiendanube.isConfigured() });
});

// Devuelve el Store ID y si hay un token guardado, pero NUNCA el token en sí.
app.get('/api/tiendanube/config', async (req, res) => {
  res.json(await tiendanube.getPublicConfig());
});

app.put('/api/tiendanube/config', async (req, res) => {
  try {
    const { storeId, accessToken, userAgent } = req.body || {};
    await store.saveTiendaNubeConfig({ storeId, accessToken, userAgent });
    res.json(await tiendanube.getPublicConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Datos de la app de Partner Portal (Client ID / Client Secret) para el
// flujo OAuth, que funciona en cualquier plan de Tienda Nube.
app.get('/api/tiendanube/oauth-config', async (req, res) => {
  res.json(await tiendanube.getOAuthPublicConfig());
});

app.put('/api/tiendanube/oauth-config', async (req, res) => {
  try {
    const { clientId, clientSecret } = req.body || {};
    await store.saveTiendaNubeConfig({ clientId, clientSecret });
    res.json(await tiendanube.getOAuthPublicConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Arranca el flujo OAuth: manda al usuario a autorizar la instalación en
// Tienda Nube. El redirect_uri de vuelta se configura UNA VEZ en el Partner
// Portal (no se pasa acá) y debe apuntar a /oauth/callback en esta app.
app.get('/oauth/start', async (req, res) => {
  try {
    const url = await tiendanube.buildAuthorizeUrl();
    res.redirect(url);
  } catch (err) {
    res.redirect(`/?oauthError=${encodeURIComponent(err.message)}`);
  }
});

// Vuelta del flujo OAuth: Tienda Nube redirige acá con ?code=... . Lo
// canjeamos por un access_token real y guardamos storeId + accessToken.
app.get('/oauth/callback', async (req, res) => {
  const { code, error, error_description: errorDescription } = req.query;
  if (error) {
    return res.redirect(`/?oauthError=${encodeURIComponent(errorDescription || error)}`);
  }
  if (!code) {
    return res.redirect(`/?oauthError=${encodeURIComponent('Tienda Nube no envió un código de autorización.')}`);
  }
  try {
    const result = await tiendanube.completeOAuth(code);
    res.redirect(`/?oauthSuccess=${encodeURIComponent(result.storeId)}`);
  } catch (err) {
    res.redirect(`/?oauthError=${encodeURIComponent(err.message)}`);
  }
});

// Prueba las credenciales guardadas contra la API real de Tienda Nube (sin
// modificar nada), para poder mostrar "conexión exitosa" o el error puntual.
app.post('/api/tiendanube/test', async (req, res) => {
  try {
    if (!(await tiendanube.isConfigured())) {
      return res.status(400).json({ ok: false, error: 'Falta el Store ID o el Access Token.' });
    }
    const result = await tiendanube.testConnection();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/settings', async (req, res) => {
  res.json(await store.getSettings());
});

app.put('/api/settings', async (req, res) => {
  res.json(await store.saveSettings(req.body || {}));
});

// Gastos del negocio (producción, packaging, publicidad, herramientas
// digitales, etc.), fijos o variables. Se usan para calcular cuánto le toca
// a cada unidad vendida (ver store.summarizeExpenses).
app.get('/api/expenses', async (req, res) => {
  try {
    const settings = await store.getSettings();
    const expenses = await store.getAllExpenses();
    const summary = store.summarizeExpenses(expenses, settings.estimatedMonthlySales);
    res.json({
      expenses: Object.entries(expenses).map(([id, e]) => ({ id, ...e })),
      summary,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/expenses', async (req, res) => {
  try {
    const { name, amount, type } = req.body || {};
    const id = await store.createExpense({ name, amount, type });
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/expenses/:id', async (req, res) => {
  try {
    await store.deleteExpense(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pedidos al proveedor: a diferencia de los gastos, el envío de un pedido de
// mercadería no es mensual ni previsible, así que no se prorratea contra
// ventas estimadas — se reparte directo entre las unidades de ESE pedido.
// Sólo el pedido marcado como "activo" afecta el costo de los productos.
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await store.getAllOrders();
    res.json({
      orders: Object.entries(orders).map(([id, o]) => ({ id, ...o })),
      supplierShippingPerUnit: store.activeOrderShippingPerUnit(orders),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { name, date, shippingCost, totalUnits } = req.body || {};
    const id = await store.createOrder({ name, date, shippingCost, totalUnits });
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders/:id/activate', async (req, res) => {
  try {
    const updated = await store.setActiveOrder(req.params.id);
    if (!updated) return res.status(404).json({ error: 'Pedido no encontrado.' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    await store.deleteOrder(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const COMBO_SIZES = ['20x30', '30x40', '40x50'];

// "Precios por combo": compara vender Individual / Set x2 / Set x3 de cada
// medida de "Cuadro Negro", usando el costo real cargado en Productos, el
// envío del pedido al proveedor activo y los gastos del negocio (ver
// calculateComboRow en shared/pricing.mjs para el detalle de la fórmula).
app.get('/api/combos', async (req, res) => {
  try {
    const settings = await store.getSettings();
    const expenses = await store.getAllExpenses();
    const orders = await store.getAllOrders();
    const allProductData = await store.getAllProductData();
    const comboSettings = await store.getComboSettings();

    const expenseBreakdown = store.summarizeExpenses(expenses, settings.estimatedMonthlySales);
    const supplierShippingPerUnit = store.activeOrderShippingPerUnit(orders);

    const sizes = {};
    for (const size of COMBO_SIZES) {
      const individualPrice = comboSettings.individualPrices[size] ?? 0;
      const product = findCuadroNegroProduct(allProductData, size);

      if (!product) {
        sizes[size] = {
          individualPrice,
          missing: true,
          warning: `No encontré un producto manual llamado "Cuadro Negro ${size}" en Productos — cargalo ahí para ver los costos de esta medida.`,
          rows: [],
        };
        continue;
      }

      const rowConfigs = [
        { label: 'Individual', quantity: 1, discount: 0 },
        { label: 'Set x2', quantity: 2, discount: comboSettings.discountX2 },
        { label: 'Set x3', quantity: 3, discount: comboSettings.discountX3 },
      ];

      sizes[size] = {
        individualPrice,
        missing: false,
        rows: rowConfigs.map(({ label, quantity, discount }) => ({
          label,
          quantity,
          discount,
          ...calculateComboRow({
            individualPrice,
            quantity,
            discount,
            costPerUnit: product.cost,
            supplierShippingPerUnit,
            variablePerUnit: expenseBreakdown.totalVariablePerUnit,
            variablePerOrder: expenseBreakdown.totalVariablePerOrder,
            fixedPerOrder: expenseBreakdown.fixedCostPerUnit,
            paymentFeePct: settings.paymentFeePct,
            taxPct: settings.taxPct,
          }),
        })),
      };
    }

    res.json({ sizes, comboSettings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/combos', async (req, res) => {
  try {
    const { individualPrices, discountX2, discountX3 } = req.body || {};
    const partial = {};
    if (individualPrices !== undefined) partial.individualPrices = individualPrices;
    if (discountX2 !== undefined) partial.discountX2 = Number(discountX2) || 0;
    if (discountX3 !== undefined) partial.discountX3 = Number(discountX3) || 0;
    const saved = await store.saveComboSettings(partial);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function isValidDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

function isValidMonthString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function monthKeyFromDate(dateStr) {
  return dateStr.slice(0, 7);
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// "Publicidad mes a mes": compara lo que se va cargando a la tarjeta de
// pauta contra lo que la plataforma gastó realmente cada mes, y calcula el
// costo por cliente real contra el estimado (el gasto de "Gastos del
// negocio" cuyo nombre contiene "publicidad" — ver
// calculateAdSpendMonthRow en shared/pricing.mjs para el detalle).
app.get('/api/ad-spend', async (req, res) => {
  try {
    const expenses = await store.getAllExpenses();
    const chargesMap = await store.getAllAdCharges();
    const monthsMap = await store.getAllAdMonths();
    const estimatedCostPerClient = store.estimatedCostPerClientFromExpenses(expenses);

    const charges = Object.entries(chargesMap)
      .map(([id, c]) => ({ id, ...c }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    const chargedByMonth = {};
    for (const charge of charges) {
      const key = monthKeyFromDate(charge.date);
      chargedByMonth[key] = (chargedByMonth[key] || 0) + charge.amount;
    }

    // Siempre se muestran todos los meses con cargas o datos guardados, y
    // siempre el mes actual (aunque todavía no tenga nada cargado).
    const allMonthKeys = new Set([...Object.keys(chargedByMonth), ...Object.keys(monthsMap), currentMonthKey()]);

    const months = [...allMonthKeys]
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
      .map((month) => {
        const saved = monthsMap[month] || {};
        return {
          month,
          ...calculateAdSpendMonthRow({
            chargedToCard: chargedByMonth[month] || 0,
            realSpend: saved.realSpend ?? null,
            sales: saved.sales ?? null,
            estimatedCostPerClient,
          }),
        };
      });

    let totalCharged = 0;
    let totalRealSpend = 0;
    let totalSales = 0;
    for (const m of months) {
      totalCharged += m.chargedToCard;
      if (m.realSpend !== null) totalRealSpend += m.realSpend;
      if (m.sales !== null) totalSales += m.sales;
    }
    const avgCostPerClientReal = totalSales > 0 ? totalRealSpend / totalSales : null;

    res.json({
      charges,
      months,
      estimatedCostPerClient,
      summary: { totalCharged, totalRealSpend, estimatedCostPerClient, avgCostPerClientReal },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ad-spend/charges', async (req, res) => {
  try {
    const { date, amount, note } = req.body || {};
    if (!isValidDateString(date)) {
      return res.status(400).json({ error: 'La fecha es obligatoria y debe tener formato YYYY-MM-DD.' });
    }
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: 'El monto es obligatorio y debe ser mayor a 0.' });
    }
    const id = await store.createAdCharge({ date, amount: amountNum, note });
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/ad-spend/charges/:id', async (req, res) => {
  try {
    await store.deleteAdCharge(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/ad-spend/months/:month', async (req, res) => {
  try {
    if (!isValidMonthString(req.params.month)) {
      return res.status(400).json({ error: 'El mes debe tener formato YYYY-MM.' });
    }
    const { realSpend, sales } = req.body || {};
    const saved = await store.saveAdMonth(req.params.month, {
      realSpend: normalizeNullableNumber(realSpend),
      sales: normalizeNullableNumber(sales),
    });
    res.json({ month: req.params.month, ...saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Devuelve la lista combinada de productos: si Tienda Nube está configurada,
// trae los productos reales de la tienda; si no, sólo los productos manuales
// cargados localmente. En ambos casos les suma costos guardados y el precio
// sugerido calculado.
app.get('/api/products', async (req, res) => {
  try {
    const settings = await store.getSettings();
    const allProductData = await store.getAllProductData();
    const expenseSummary = await getExpenseSummary();
    const configured = await tiendanube.isConfigured();

    let items = [];

    if (configured) {
      const tnProducts = await tiendanube.listProducts();
      items = tnProducts.map((p) => {
        const variant = p.variants[0] || {};
        return {
          id: p.id,
          variantId: variant.id ?? null,
          name: p.name,
          source: 'tiendanube',
          currentPrice: variant.price ?? null,
        };
      });
    }

    // Sumamos los productos manuales (existen aunque haya tienda conectada,
    // por si el usuario quiere simular algo sin publicarlo).
    for (const [id, data] of Object.entries(allProductData)) {
      if (data.manual) {
        items.push({
          id,
          variantId: null,
          name: data.manual.name,
          source: 'manual',
          currentPrice: data.manual.price ?? null,
        });
      }
    }

    const enriched = items.map((item) => {
      const productData = allProductData[item.id] || null;
      const inputs = effectiveInputs(settings, productData, expenseSummary);
      const suggested = calculateSuggestedPrice(inputs);
      return {
        ...item,
        cost: inputs.cost,
        shipping: inputs.shipping,
        overrides: productData?.overrides || {},
        suggested,
      };
    });

    res.json({ configured, settings, expenseSummary, products: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Guarda costo/envío/overrides de un producto puntual (de Tienda Nube o
// manual). Es un merge parcial: mandar sólo "overrides" no pisa el costo/
// envío ya guardados, y viceversa.
app.put('/api/products/:id/costs', async (req, res) => {
  try {
    const { cost, shipping, overrides } = req.body || {};
    const current = await store.getProductData(req.params.id);
    const saved = await store.saveProductData(req.params.id, {
      cost: cost !== undefined ? Number(cost) || 0 : (current?.cost ?? 0),
      shipping: shipping !== undefined ? Number(shipping) || 0 : (current?.shipping ?? 0),
      overrides: overrides !== undefined ? overrides : current?.overrides || {},
    });
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Devuelve el desglose de "qué pasaría con el precio actual" para comparar
// contra el precio sugerido (útil para productos que ya están publicados).
app.get('/api/products/:id/breakdown-at-current-price', async (req, res) => {
  try {
    const price = Number(req.query.price);
    const settings = await store.getSettings();
    const productData = await store.getProductData(req.params.id);
    const expenseSummary = await getExpenseSummary();
    const inputs = effectiveInputs(settings, productData, expenseSummary);
    res.json(calculateBreakdownForPrice(price, inputs));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products/manual', async (req, res) => {
  try {
    const { name, price, cost, shipping } = req.body || {};
    const id = await store.createManualProduct({ name, price, cost, shipping });
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/manual/:id', async (req, res) => {
  try {
    await store.deleteProductData(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Calcula el precio sugerido y lo aplica directamente en Tienda Nube.
app.post('/api/products/:id/apply-price', async (req, res) => {
  try {
    if (!(await tiendanube.isConfigured())) {
      return res.status(400).json({ error: 'Tienda Nube no está configurada.' });
    }
    const { variantId } = req.body || {};
    if (!variantId) {
      return res.status(400).json({ error: 'Falta variantId.' });
    }

    const settings = await store.getSettings();
    const productData = await store.getProductData(req.params.id);
    const expenseSummary = await getExpenseSummary();
    const inputs = effectiveInputs(settings, productData, expenseSummary);
    const suggested = calculateSuggestedPrice(inputs);

    if (!suggested.ok) {
      return res.status(400).json({ error: suggested.error });
    }

    await tiendanube.updateVariantPrice(req.params.id, variantId, suggested.price);
    res.json({ appliedPrice: suggested.price });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default app;
