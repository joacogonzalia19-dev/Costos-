import { calculateSuggestedPrice } from '/shared/pricing.mjs';

const fmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });
const pctFmt = (fraction) => `${(fraction * 100).toFixed(1)}%`;

const state = {
  settings: null,
  products: [],
};

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Error ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function fractionFromPercentInput(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n / 100 : 0;
}

async function loadAll() {
  const [settings, productsResp] = await Promise.all([api('/api/settings'), api('/api/products')]);
  state.settings = settings;
  state.products = productsResp.products;
  renderSettingsForm();
  renderProductsTable();
}

function renderSettingsForm() {
  document.getElementById('paymentFeePct').value = (state.settings.paymentFeePct * 100).toFixed(2);
  document.getElementById('taxPct').value = (state.settings.taxPct * 100).toFixed(2);
  document.getElementById('fixedCostPct').value = (state.settings.fixedCostPct * 100).toFixed(2);
  document.getElementById('marginPct').value = (state.settings.marginPct * 100).toFixed(2);
}

function effectiveInputsFor(product) {
  const overrides = product.overrides || {};
  return {
    cost: product.cost,
    shipping: product.shipping,
    paymentFeePct: overrides.paymentFeePct ?? state.settings.paymentFeePct,
    taxPct: overrides.taxPct ?? state.settings.taxPct,
    fixedCostPct: overrides.fixedCostPct ?? state.settings.fixedCostPct,
    marginPct: overrides.marginPct ?? state.settings.marginPct,
  };
}

function renderProductsTable() {
  const tbody = document.getElementById('products-tbody');
  tbody.innerHTML = '';

  for (const product of state.products) {
    const tr = document.createElement('tr');

    const suggested = calculateSuggestedPrice(effectiveInputsFor(product));

    const nameTd = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = product.name;
    nameTd.appendChild(nameInput);
    tr.appendChild(nameTd);

    const costTd = document.createElement('td');
    const costInput = document.createElement('input');
    costInput.type = 'number';
    costInput.step = '0.01';
    costInput.className = 'row-cost-input';
    costInput.value = product.cost;
    costTd.appendChild(costInput);
    tr.appendChild(costTd);

    const shippingTd = document.createElement('td');
    const shippingInput = document.createElement('input');
    shippingInput.type = 'number';
    shippingInput.step = '0.01';
    shippingInput.className = 'row-cost-input';
    shippingInput.value = product.shipping;
    shippingTd.appendChild(shippingInput);
    tr.appendChild(shippingTd);

    const suggestedTd = document.createElement('td');
    suggestedTd.textContent = suggested.ok ? fmt.format(suggested.price) : '⚠️';
    if (!suggested.ok) suggestedTd.title = suggested.error;
    tr.appendChild(suggestedTd);

    const marginTd = document.createElement('td');
    if (suggested.ok) {
      marginTd.textContent = `${fmt.format(suggested.breakdown.marginAmount)} (${pctFmt(state.settings.marginPct)})`;
      marginTd.className = 'margin-ok';
    } else {
      marginTd.textContent = '—';
    }
    tr.appendChild(marginTd);

    const actionsTd = document.createElement('td');
    actionsTd.style.display = 'flex';
    actionsTd.style.gap = '0.4rem';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'secondary';
    saveBtn.textContent = 'Guardar';
    saveBtn.onclick = async () => {
      await api(`/api/products/${product.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: nameInput.value,
          cost: costInput.value,
          shipping: shippingInput.value,
        }),
      });
      await loadAll();
    };
    actionsTd.appendChild(saveBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'secondary';
    deleteBtn.textContent = 'Eliminar';
    deleteBtn.onclick = async () => {
      if (!confirm(`¿Eliminar "${product.name}"?`)) return;
      await api(`/api/products/${product.id}`, { method: 'DELETE' });
      await loadAll();
    };
    actionsTd.appendChild(deleteBtn);

    tr.appendChild(actionsTd);
    tbody.appendChild(tr);
  }
}

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({
      paymentFeePct: fractionFromPercentInput(document.getElementById('paymentFeePct').value),
      taxPct: fractionFromPercentInput(document.getElementById('taxPct').value),
      fixedCostPct: fractionFromPercentInput(document.getElementById('fixedCostPct').value),
      marginPct: fractionFromPercentInput(document.getElementById('marginPct').value),
    }),
  });
  await loadAll();
});

document.getElementById('add-product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-name').value;
  const cost = document.getElementById('new-cost').value;
  const shipping = document.getElementById('new-shipping').value;
  await api('/api/products', {
    method: 'POST',
    body: JSON.stringify({ name, cost, shipping }),
  });
  e.target.reset();
  await loadAll();
});

loadAll().catch((err) => {
  console.error(err);
  alert(`No se pudo cargar la app: ${err.message}`);
});
