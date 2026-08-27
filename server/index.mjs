import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

import { calculateSuggestedPrice, calculateBreakdownForPrice } from '../shared/pricing.mjs';
import * as store from './store.mjs';
import * as tiendanube from './tiendanube.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// Sirve el frontend estático y el módulo de cálculo compartido (para que el
// navegador pueda hacer `import ... from '/shared/pricing.mjs'` y usar
// exactamente la misma lógica que el backend).
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

function effectiveInputs(settings, productData) {
  const overrides = productData?.overrides || {};
  return {
    cost: productData?.cost ?? 0,
    shipping: productData?.shipping ?? 0,
    paymentFeePct: overrides.paymentFeePct ?? settings.paymentFeePct,
    taxPct: overrides.taxPct ?? settings.taxPct,
    fixedCostPct: overrides.fixedCostPct ?? settings.fixedCostPct,
    marginPct: overrides.marginPct ?? settings.marginPct,
  };
}

app.get('/api/tiendanube/status', (req, res) => {
  res.json({ configured: tiendanube.isConfigured() });
});

app.get('/api/settings', async (req, res) => {
  res.json(await store.getSettings());
});

app.put('/api/settings', async (req, res) => {
  res.json(await store.saveSettings(req.body || {}));
});

// Devuelve la lista combinada de productos: si Tienda Nube está configurada,
// trae los productos reales de la tienda; si no, sólo los productos manuales
// cargados localmente. En ambos casos les suma costos guardados y el precio
// sugerido calculado.
app.get('/api/products', async (req, res) => {
  try {
    const settings = await store.getSettings();
    const allProductData = await store.getAllProductData();
    const configured = tiendanube.isConfigured();

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
      const inputs = effectiveInputs(settings, productData);
      const suggested = calculateSuggestedPrice(inputs);
      return {
        ...item,
        cost: inputs.cost,
        shipping: inputs.shipping,
        overrides: productData?.overrides || {},
        suggested,
      };
    });

    res.json({ configured, settings, products: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Guarda costo/envío/overrides de un producto puntual (de Tienda Nube o manual).
app.put('/api/products/:id/costs', async (req, res) => {
  try {
    const { cost, shipping, overrides } = req.body || {};
    const saved = await store.saveProductData(req.params.id, {
      cost: Number(cost) || 0,
      shipping: Number(shipping) || 0,
      overrides: overrides || {},
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
    const inputs = effectiveInputs(settings, productData);
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
    if (!tiendanube.isConfigured()) {
      return res.status(400).json({ error: 'Tienda Nube no está configurada.' });
    }
    const { variantId } = req.body || {};
    if (!variantId) {
      return res.status(400).json({ error: 'Falta variantId.' });
    }

    const settings = await store.getSettings();
    const productData = await store.getProductData(req.params.id);
    const inputs = effectiveInputs(settings, productData);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Costos- corriendo en http://localhost:${PORT}`);
  console.log(
    tiendanube.isConfigured()
      ? 'Tienda Nube: conectada.'
      : 'Tienda Nube: no configurada (modo manual). Ver .env.example.',
  );
});
