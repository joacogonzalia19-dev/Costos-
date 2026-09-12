import { calculateSuggestedPrice } from '/shared/pricing.mjs';

const fmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });
const pctFmt = (fraction) => `${(fraction * 100).toFixed(1)}%`;

const state = {
  settings: null,
  products: [],
  configured: false,
  tiendanubeConfig: null,
  oauthConfig: null,
  expenses: [],
  expenseSummary: { totalFixedMonthly: 0, totalVariablePerUnit: 0, fixedCostPerUnit: 0 },
};

// Ids de producto con el panel de "ajustes propios" (overrides) desplegado.
// Es sólo estado de UI, no se persiste: se resetea al recargar la página.
const expandedOverrides = new Set();

const OVERRIDE_FIELDS = [
  { key: 'paymentFeePct', label: 'Comisión de pago (%)' },
  { key: 'taxPct', label: 'Impuestos (%)' },
  { key: 'marginPct', label: 'Margen deseado (%)' },
];

const EXPENSE_TYPE_LABELS = { fixed: 'Fijo (mensual)', variable: 'Variable (por unidad)' };

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = '/login.html';
    return new Promise(() => {}); // corta la ejecución; ya estamos navegando afuera.
  }
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
  const [settings, statusResp, productsResp, tnConfig, oauthConfig, expensesResp] = await Promise.all([
    api('/api/settings'),
    api('/api/tiendanube/status'),
    api('/api/products'),
    api('/api/tiendanube/config'),
    api('/api/tiendanube/oauth-config'),
    api('/api/expenses'),
  ]);
  state.settings = settings;
  state.configured = statusResp.configured;
  state.products = productsResp.products;
  state.tiendanubeConfig = tnConfig;
  state.oauthConfig = oauthConfig;
  state.expenses = expensesResp.expenses;
  state.expenseSummary = expensesResp.summary;
  renderStatus();
  renderSettingsForm();
  renderTiendaNubeForm();
  renderOAuthForm();
  renderExpensesTable();
  renderProductsTable();
}

/** Muestra el resultado del flujo OAuth (?oauthSuccess=storeId / ?oauthError=mensaje) y limpia la URL. */
function renderOAuthFlash() {
  const params = new URLSearchParams(window.location.search);
  const flashEl = document.getElementById('oauth-flash');
  if (params.has('oauthSuccess')) {
    flashEl.textContent = `✅ Conectado correctamente (Store ID ${params.get('oauthSuccess')}).`;
  } else if (params.has('oauthError')) {
    flashEl.textContent = `❌ No se pudo conectar: ${params.get('oauthError')}`;
  } else {
    return;
  }
  window.history.replaceState({}, '', window.location.pathname);
}

function renderStatus() {
  const badge = document.getElementById('tn-status');
  if (state.configured) {
    badge.textContent = 'Tienda Nube conectada';
    badge.classList.add('connected');
  } else {
    badge.textContent = 'Modo manual (Tienda Nube no configurada)';
    badge.classList.remove('connected');
  }
}

function renderOAuthForm() {
  const cfg = state.oauthConfig;
  document.getElementById('tn-clientId').value = cfg.clientId || '';
  document.getElementById('tn-clientSecret').placeholder = cfg.hasClientSecret
    ? '•••••••• (ya hay uno guardado; dejar vacío para no cambiarlo)'
    : 'Pegá acá tu Client Secret';
  const startBtn = document.getElementById('oauth-start-btn');
  startBtn.disabled = !cfg.clientId;
  startBtn.title = cfg.clientId ? '' : 'Primero guardá el Client ID y Client Secret.';
}

function renderTiendaNubeForm() {
  const cfg = state.tiendanubeConfig;
  document.getElementById('tn-storeId').value = cfg.storeId || '';
  document.getElementById('tn-userAgent').value = cfg.userAgent || '';
  document.getElementById('tn-accessToken').placeholder = cfg.hasToken
    ? '•••••••• (ya hay un token guardado; dejar vacío para no cambiarlo)'
    : 'Pegá acá tu Access Token';
}

function renderSettingsForm() {
  document.getElementById('paymentFeePct').value = (state.settings.paymentFeePct * 100).toFixed(2);
  document.getElementById('taxPct').value = (state.settings.taxPct * 100).toFixed(2);
  document.getElementById('marginPct').value = (state.settings.marginPct * 100).toFixed(2);
  document.getElementById('estimatedMonthlySales').value = state.settings.estimatedMonthlySales;
}

function renderExpensesTable() {
  const tbody = document.getElementById('expenses-tbody');
  tbody.innerHTML = '';

  for (const expense of state.expenses) {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.textContent = expense.name;
    tr.appendChild(nameTd);

    const typeTd = document.createElement('td');
    typeTd.textContent = EXPENSE_TYPE_LABELS[expense.type] || expense.type;
    tr.appendChild(typeTd);

    const amountTd = document.createElement('td');
    amountTd.textContent = fmt.format(expense.amount) + (expense.type === 'fixed' ? '/mes' : '/unidad');
    tr.appendChild(amountTd);

    const actionsTd = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'secondary';
    deleteBtn.textContent = 'Eliminar';
    deleteBtn.onclick = async () => {
      if (!confirm(`¿Eliminar el gasto "${expense.name}"?`)) return;
      await api(`/api/expenses/${expense.id}`, { method: 'DELETE' });
      await loadAll();
    };
    actionsTd.appendChild(deleteBtn);
    tr.appendChild(actionsTd);

    tbody.appendChild(tr);
  }

  const s = state.expenseSummary;
  document.getElementById('expenses-summary').textContent =
    `Total gastos fijos: ${fmt.format(s.totalFixedMonthly)}/mes → ${fmt.format(s.fixedCostPerUnit)} por unidad ` +
    `(con ${state.settings.estimatedMonthlySales} ventas estimadas/mes). ` +
    `Total gastos variables: ${fmt.format(s.totalVariablePerUnit)} por unidad.`;
}

function effectiveInputsFor(product) {
  const overrides = product.overrides || {};
  return {
    cost: product.cost,
    shipping: product.shipping,
    fixedCostPerUnit: state.expenseSummary.fixedCostPerUnit,
    variableCostPerUnit: state.expenseSummary.totalVariablePerUnit,
    paymentFeePct: overrides.paymentFeePct ?? state.settings.paymentFeePct,
    taxPct: overrides.taxPct ?? state.settings.taxPct,
    marginPct: overrides.marginPct ?? state.settings.marginPct,
  };
}

const TABLE_COLUMN_COUNT = 7; // Producto, Precio actual, Costo, Envío, Precio sugerido, Margen neto, acciones.

function renderProductsTable() {
  const tbody = document.getElementById('products-tbody');
  tbody.innerHTML = '';

  for (const product of state.products) {
    const tr = document.createElement('tr');

    const effective = effectiveInputsFor(product);
    const suggested = calculateSuggestedPrice(effective);
    const hasOverrides = Object.keys(product.overrides || {}).length > 0;

    const gastosPorUnidad = effective.fixedCostPerUnit + effective.variableCostPerUnit;
    const nameTd = document.createElement('td');
    nameTd.innerHTML = `${product.name}<br><span class="small-muted">${product.source === 'tiendanube' ? 'Tienda Nube' : 'Manual'}${gastosPorUnidad > 0 ? ` · +${fmt.format(gastosPorUnidad)} gastos` : ''}</span>`;
    if (hasOverrides) {
      const marker = document.createElement('span');
      marker.className = 'small-muted';
      marker.title = 'Este producto tiene ajustes propios (distintos del default)';
      marker.textContent = ' ⚙';
      nameTd.appendChild(marker);
    }
    tr.appendChild(nameTd);

    const currentPriceTd = document.createElement('td');
    currentPriceTd.textContent = product.currentPrice != null ? fmt.format(product.currentPrice) : '—';
    tr.appendChild(currentPriceTd);

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
      marginTd.textContent = `${fmt.format(suggested.breakdown.marginAmount)} (${pctFmt(effective.marginPct)})`;
      marginTd.className = 'margin-ok';
    } else {
      marginTd.textContent = '—';
    }
    tr.appendChild(marginTd);

    const actionsTd = document.createElement('td');
    actionsTd.style.display = 'flex';
    actionsTd.style.gap = '0.4rem';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'secondary';
    toggleBtn.textContent = expandedOverrides.has(product.id) ? 'Ocultar ajustes' : 'Ajustes propios';
    toggleBtn.onclick = () => {
      if (expandedOverrides.has(product.id)) expandedOverrides.delete(product.id);
      else expandedOverrides.add(product.id);
      renderProductsTable();
    };
    actionsTd.appendChild(toggleBtn);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'secondary';
    saveBtn.textContent = 'Guardar costos';
    saveBtn.onclick = async () => {
      await api(`/api/products/${product.id}/costs`, {
        method: 'PUT',
        body: JSON.stringify({
          cost: costInput.value,
          shipping: shippingInput.value,
        }),
      });
      await loadAll();
    };
    actionsTd.appendChild(saveBtn);

    if (product.source === 'tiendanube' && state.configured && suggested.ok) {
      const applyBtn = document.createElement('button');
      applyBtn.textContent = 'Aplicar en Tienda Nube';
      applyBtn.onclick = async () => {
        if (!confirm(`¿Actualizar el precio de "${product.name}" a ${fmt.format(suggested.price)} en Tienda Nube?`)) return;
        try {
          await api(`/api/products/${product.id}/apply-price`, {
            method: 'POST',
            body: JSON.stringify({ variantId: product.variantId }),
          });
          await loadAll();
        } catch (err) {
          alert(`No se pudo aplicar el precio: ${err.message}`);
        }
      };
      actionsTd.appendChild(applyBtn);
    }

    if (product.source === 'manual') {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'secondary';
      deleteBtn.textContent = 'Eliminar';
      deleteBtn.onclick = async () => {
        if (!confirm(`¿Eliminar "${product.name}"?`)) return;
        await api(`/api/products/manual/${product.id}`, { method: 'DELETE' });
        await loadAll();
      };
      actionsTd.appendChild(deleteBtn);
    }

    tr.appendChild(actionsTd);
    tbody.appendChild(tr);

    if (expandedOverrides.has(product.id)) {
      tbody.appendChild(renderOverrideRow(product));
    }
  }
}

/**
 * Fila expandible con los 4 porcentajes propios de un producto (comisión,
 * impuestos, costos fijos, margen), que pisan el default global sólo para
 * ese producto. Vacío = usa el default (se ve como placeholder).
 */
function renderOverrideRow(product) {
  const overrideTr = document.createElement('tr');
  overrideTr.className = 'override-row';

  const td = document.createElement('td');
  td.colSpan = TABLE_COLUMN_COUNT;

  const grid = document.createElement('div');
  grid.className = 'settings-grid';

  const inputs = {};
  for (const field of OVERRIDE_FIELDS) {
    const label = document.createElement('label');
    label.textContent = field.label;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.01';
    const overrideValue = product.overrides?.[field.key];
    input.value = overrideValue !== undefined ? (overrideValue * 100).toFixed(2) : '';
    input.placeholder = `default ${(state.settings[field.key] * 100).toFixed(2)}%`;
    label.appendChild(input);
    grid.appendChild(label);
    inputs[field.key] = input;
  }

  const saveOverridesBtn = document.createElement('button');
  saveOverridesBtn.textContent = 'Guardar ajustes propios';
  saveOverridesBtn.onclick = async () => {
    const overrides = {};
    for (const field of OVERRIDE_FIELDS) {
      const raw = inputs[field.key].value.trim();
      if (raw !== '') overrides[field.key] = fractionFromPercentInput(raw);
    }
    await api(`/api/products/${product.id}/costs`, { method: 'PUT', body: JSON.stringify({ overrides }) });
    await loadAll();
  };
  grid.appendChild(saveOverridesBtn);

  const clearOverridesBtn = document.createElement('button');
  clearOverridesBtn.className = 'secondary';
  clearOverridesBtn.textContent = 'Quitar ajustes propios';
  clearOverridesBtn.onclick = async () => {
    await api(`/api/products/${product.id}/costs`, { method: 'PUT', body: JSON.stringify({ overrides: {} }) });
    await loadAll();
  };
  grid.appendChild(clearOverridesBtn);

  td.appendChild(grid);
  overrideTr.appendChild(td);
  return overrideTr;
}

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({
      paymentFeePct: fractionFromPercentInput(document.getElementById('paymentFeePct').value),
      taxPct: fractionFromPercentInput(document.getElementById('taxPct').value),
      marginPct: fractionFromPercentInput(document.getElementById('marginPct').value),
      estimatedMonthlySales: Number(document.getElementById('estimatedMonthlySales').value) || 0,
    }),
  });
  await loadAll();
});

document.getElementById('add-expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-expense-name').value;
  const amount = document.getElementById('new-expense-amount').value;
  const type = document.getElementById('new-expense-type').value;
  await api('/api/expenses', {
    method: 'POST',
    body: JSON.stringify({ name, amount, type }),
  });
  e.target.reset();
  await loadAll();
});

document.getElementById('oauth-config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/api/tiendanube/oauth-config', {
    method: 'PUT',
    body: JSON.stringify({
      clientId: document.getElementById('tn-clientId').value.trim(),
      clientSecret: document.getElementById('tn-clientSecret').value.trim(),
    }),
  });
  document.getElementById('tn-clientSecret').value = '';
  await loadAll();
});

document.getElementById('oauth-start-btn').addEventListener('click', () => {
  window.location.href = '/oauth/start';
});

document.getElementById('tiendanube-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const resultEl = document.getElementById('tn-test-result');
  resultEl.textContent = '';
  try {
    await api('/api/tiendanube/config', {
      method: 'PUT',
      body: JSON.stringify({
        storeId: document.getElementById('tn-storeId').value.trim(),
        accessToken: document.getElementById('tn-accessToken').value.trim(),
        userAgent: document.getElementById('tn-userAgent').value.trim(),
      }),
    });
    document.getElementById('tn-accessToken').value = '';
    await loadAll();
    resultEl.textContent = 'Credenciales guardadas.';
  } catch (err) {
    resultEl.textContent = `No se pudieron guardar: ${err.message}`;
  }
});

document.getElementById('tn-test-btn').addEventListener('click', async () => {
  const resultEl = document.getElementById('tn-test-result');
  resultEl.textContent = 'Probando conexión…';
  try {
    const result = await api('/api/tiendanube/test', { method: 'POST' });
    resultEl.textContent = result.storeName
      ? `✅ Conectado correctamente a "${result.storeName}".`
      : '✅ Conectado correctamente.';
    await loadAll();
  } catch (err) {
    resultEl.textContent = `❌ ${err.message}`;
  }
});

document.getElementById('add-product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-name').value;
  const cost = document.getElementById('new-cost').value;
  const shipping = document.getElementById('new-shipping').value;
  await api('/api/products/manual', {
    method: 'POST',
    body: JSON.stringify({ name, cost, shipping }),
  });
  e.target.reset();
  await loadAll();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

renderOAuthFlash();
loadAll().catch((err) => {
  console.error(err);
  alert(`No se pudo cargar la app: ${err.message}`);
});
