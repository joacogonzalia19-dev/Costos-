import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

import { calculateSuggestedPrice } from '../shared/pricing.mjs';
import * as store from './store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// Sirve el frontend estático y el módulo de cálculo compartido (para que el
// navegador pueda hacer `import ... from '/shared/pricing.mjs'` y usar
// exactamente la misma lógica que el backend).
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

function effectiveInputs(settings, product) {
  const overrides = product.overrides || {};
  return {
    cost: product.cost,
    shipping: product.shipping,
    paymentFeePct: overrides.paymentFeePct ?? settings.paymentFeePct,
    taxPct: overrides.taxPct ?? settings.taxPct,
    fixedCostPct: overrides.fixedCostPct ?? settings.fixedCostPct,
    marginPct: overrides.marginPct ?? settings.marginPct,
  };
}

app.get('/api/settings', async (req, res) => {
  res.json(await store.getSettings());
});

app.put('/api/settings', async (req, res) => {
  res.json(await store.saveSettings(req.body || {}));
});

app.get('/api/products', async (req, res) => {
  try {
    const settings = await store.getSettings();
    const all = await store.getAllProducts();

    const products = Object.entries(all).map(([id, product]) => ({
      id,
      name: product.name,
      cost: product.cost,
      shipping: product.shipping,
      overrides: product.overrides || {},
      suggested: calculateSuggestedPrice(effectiveInputs(settings, product)),
    }));

    res.json({ settings, products });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { name, cost, shipping } = req.body || {};
    const id = await store.createProduct({ name, cost, shipping });
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { name, cost, shipping, overrides } = req.body || {};
    const updated = await store.updateProduct(req.params.id, { name, cost, shipping, overrides });
    if (!updated) return res.status(404).json({ error: 'Producto no encontrado.' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await store.deleteProduct(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Costos- corriendo en http://localhost:${PORT}`);
});
