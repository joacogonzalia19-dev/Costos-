import { calculateSuggestedPrice } from '/shared/pricing.mjs';

const COMBO_SIZES = ['20x30', '30x40', '40x50'];

const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

const fmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });
const pctFmt = (fraction) => `${(fraction * 100).toFixed(1)}%`;

const state = {
  settings: null,
  products: [],
  configured: false,
  tiendanubeConfig: null,
  oauthConfig: null,
  expenses: [],
  expenseSummary: { totalFixedMonthly: 0, totalVariablePerUnit: 0, totalVariablePerOrder: 0, fixedCostPerUnit: 0 },
  orders: [],
  supplierShippingPerUnit: 0,
  combos: null,
  adSpend: null,
};

// Ids de producto con el panel de "ajustes propios" (overrides) desplegado.
// Es sólo estado de UI, no se persiste: se resetea al recargar la página.
const expandedOverrides = new Set();

const OVERRIDE_FIELDS = [
  { key: 'paymentFeePct', label: 'Comisión de pago (%)' },
  { key: 'taxPct', label: 'Impuestos (%)' },
  { key: 'marginPct', label: 'Margen deseado (%)' },
];

const EXPENSE_TYPE_LABELS = {
  fixed: 'Fijo (mensual)',
  variable: 'Variable (por unidad)',
  per_order: 'Variable (por pedido)',
};

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
  const [settings, statusResp, productsResp, tnConfig, oauthConfig, expensesResp, ordersResp, combosResp, adSpendResp] =
    await Promise.all([
      api('/api/settings'),
      api('/api/tiendanube/status'),
      api('/api/products'),
      api('/api/tiendanube/config'),
      api('/api/tiendanube/oauth-config'),
      api('/api/expenses'),
      api('/api/orders'),
      api('/api/combos'),
      api('/api/ad-spend'),
    ]);
  state.settings = settings;
  state.configured = statusResp.configured;
  state.products = productsResp.products;
  state.tiendanubeConfig = tnConfig;
  state.oauthConfig = oauthConfig;
  state.expenses = expensesResp.expenses;
  state.expenseSummary = expensesResp.summary;
  state.orders = ordersResp.orders;
  state.supplierShippingPerUnit = ordersResp.supplierShippingPerUnit;
  state.combos = combosResp;
  state.adSpend = adSpendResp;
  renderStatus();
  renderSettingsForm();
  renderTiendaNubeForm();
  renderOAuthForm();
  renderExpensesTable();
  renderOrdersTable();
  renderProductsTable();
  renderCombosForm();
  renderCombosTables();
  renderAdChargesTable();
  renderAdMonthsTable();
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
  let summaryText =
    `Total gastos fijos: ${fmt.format(s.totalFixedMonthly)}/mes → ${fmt.format(s.fixedCostPerUnit)} por unidad ` +
    `(con ${state.settings.estimatedMonthlySales} ventas estimadas/mes). ` +
    `Total gastos variables: ${fmt.format(s.totalVariablePerUnit)} por unidad.`;
  if (s.totalVariablePerOrder > 0) {
    summaryText += ` Total gastos por pedido: ${fmt.format(s.totalVariablePerOrder)} (una vez por pedido; en productos individuales se suma igual que los de por unidad).`;
  }
  document.getElementById('expenses-summary').textContent = summaryText;
}

function renderOrdersTable() {
  const tbody = document.getElementById('orders-tbody');
  tbody.innerHTML = '';

  for (const order of state.orders) {
    const tr = document.createElement('tr');
    if (order.active) tr.className = 'override-row';

    const nameTd = document.createElement('td');
    nameTd.textContent = order.name;
    tr.appendChild(nameTd);

    const dateTd = document.createElement('td');
    dateTd.textContent = order.date || '—';
    tr.appendChild(dateTd);

    const shippingTd = document.createElement('td');
    shippingTd.textContent = fmt.format(order.shippingCost);
    tr.appendChild(shippingTd);

    const unitsTd = document.createElement('td');
    unitsTd.textContent = order.totalUnits;
    tr.appendChild(unitsTd);

    const perUnitTd = document.createElement('td');
    perUnitTd.textContent = order.totalUnits ? fmt.format(order.shippingCost / order.totalUnits) : '—';
    tr.appendChild(perUnitTd);

    const activeTd = document.createElement('td');
    if (order.active) {
      const badge = document.createElement('span');
      badge.className = 'badge connected';
      badge.textContent = 'Activo';
      activeTd.appendChild(badge);
    } else {
      const activateBtn = document.createElement('button');
      activateBtn.className = 'secondary';
      activateBtn.textContent = 'Marcar activo';
      activateBtn.onclick = async () => {
        await api(`/api/orders/${order.id}/activate`, { method: 'POST' });
        await loadAll();
      };
      activeTd.appendChild(activateBtn);
    }
    tr.appendChild(activeTd);

    const actionsTd = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'secondary';
    deleteBtn.textContent = 'Eliminar';
    deleteBtn.onclick = async () => {
      if (!confirm(`¿Eliminar el pedido "${order.name}"?`)) return;
      await api(`/api/orders/${order.id}`, { method: 'DELETE' });
      await loadAll();
    };
    actionsTd.appendChild(deleteBtn);
    tr.appendChild(actionsTd);

    tbody.appendChild(tr);
  }

  const activeOrder = state.orders.find((o) => o.active);
  document.getElementById('orders-summary').textContent = activeOrder
    ? `Envío proveedor por unidad (pedido activo: "${activeOrder.name}"): ${fmt.format(state.supplierShippingPerUnit)}.`
    : 'No hay ningún pedido activo: no se suma envío de proveedor a los productos.';
}

function renderAdChargesTable() {
  const tbody = document.getElementById('ad-charges-tbody');
  tbody.innerHTML = '';
  const charges = state.adSpend?.charges || [];

  for (const charge of charges) {
    const tr = document.createElement('tr');

    const dateTd = document.createElement('td');
    dateTd.textContent = charge.date;
    tr.appendChild(dateTd);

    const amountTd = document.createElement('td');
    amountTd.textContent = fmt.format(charge.amount);
    tr.appendChild(amountTd);

    const noteTd = document.createElement('td');
    noteTd.textContent = charge.note || '—';
    tr.appendChild(noteTd);

    const actionsTd = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'secondary';
    deleteBtn.textContent = 'Eliminar';
    deleteBtn.onclick = async () => {
      if (!confirm(`¿Eliminar la carga de ${fmt.format(charge.amount)} del ${charge.date}?`)) return;
      await api(`/api/ad-spend/charges/${charge.id}`, { method: 'DELETE' });
      await loadAll();
    };
    actionsTd.appendChild(deleteBtn);
    tr.appendChild(actionsTd);

    tbody.appendChild(tr);
  }
}

function renderAdMonthsTable() {
  const tbody = document.getElementById('ad-months-tbody');
  tbody.innerHTML = '';
  const months = state.adSpend?.months || [];

  for (const m of months) {
    const tr = document.createElement('tr');

    const monthTd = document.createElement('td');
    monthTd.textContent = formatMonthLabel(m.month);
    tr.appendChild(monthTd);

    const chargedTd = document.createElement('td');
    chargedTd.textContent = fmt.format(m.chargedToCard);
    tr.appendChild(chargedTd);

    const realSpendTd = document.createElement('td');
    const realSpendInput = document.createElement('input');
    realSpendInput.type = 'number';
    realSpendInput.step = '0.01';
    realSpendInput.min = '0';
    realSpendInput.className = 'row-cost-input';
    realSpendInput.value = m.realSpend ?? '';
    realSpendTd.appendChild(realSpendInput);
    tr.appendChild(realSpendTd);

    const diffTd = document.createElement('td');
    diffTd.textContent = m.difference === null ? '—' : fmt.format(m.difference);
    tr.appendChild(diffTd);

    const salesTd = document.createElement('td');
    const salesInput = document.createElement('input');
    salesInput.type = 'number';
    salesInput.step = '1';
    salesInput.min = '0';
    salesInput.className = 'row-cost-input';
    salesInput.value = m.sales ?? '';
    salesTd.appendChild(salesInput);
    tr.appendChild(salesTd);

    const costPerClientTd = document.createElement('td');
    costPerClientTd.textContent = m.costPerClientReal === null ? '—' : fmt.format(m.costPerClientReal);
    tr.appendChild(costPerClientTd);

    const vsEstimadoTd = document.createElement('td');
    if (m.vsEstimadoAmount === null) {
      vsEstimadoTd.textContent = '—';
    } else {
      const sign = m.vsEstimadoAmount <= 0 ? 'por debajo' : 'por encima';
      const pctText = m.vsEstimadoPct === null ? '' : ` (${pctFmt(Math.abs(m.vsEstimadoPct))} ${sign})`;
      vsEstimadoTd.textContent = `${fmt.format(m.vsEstimadoAmount)}${pctText}`;
      vsEstimadoTd.className = m.vsEstimadoAmount <= 0 ? 'profit-green' : 'profit-red';
    }
    tr.appendChild(vsEstimadoTd);

    const actionsTd = document.createElement('td');
    const saveBtn = document.createElement('button');
    saveBtn.className = 'secondary';
    saveBtn.textContent = 'Guardar';
    saveBtn.onclick = async () => {
      try {
        await api(`/api/ad-spend/months/${m.month}`, {
          method: 'PUT',
          body: JSON.stringify({
            realSpend: realSpendInput.value === '' ? null : realSpendInput.value,
            sales: salesInput.value === '' ? null : salesInput.value,
          }),
        });
        await loadAll();
      } catch (err) {
        alert(`No se pudo guardar: ${err.message}`);
      }
    };
    actionsTd.appendChild(saveBtn);
    tr.appendChild(actionsTd);

    tbody.appendChild(tr);
  }

  const s = state.adSpend?.summary;
  if (s) {
    document.getElementById('ad-spend-summary').textContent =
      `Total cargado: ${fmt.format(s.totalCharged)}. Total invertido real: ${fmt.format(s.totalRealSpend)}. ` +
      `Costo por cliente estimado: ${fmt.format(s.estimatedCostPerClient)}. ` +
      `Costo real por cliente promedio: ${s.avgCostPerClientReal === null ? '—' : fmt.format(s.avgCostPerClientReal)}.`;
  }
}

function renderCombosForm() {
  const cs = state.combos?.comboSettings;
  if (!cs) return;
  document.getElementById('combo-price-20x30').value = cs.individualPrices['20x30'];
  document.getElementById('combo-price-30x40').value = cs.individualPrices['30x40'];
  document.getElementById('combo-price-40x50').value = cs.individualPrices['40x50'];
  document.getElementById('combo-discount-x2').value = (cs.discountX2 * 100).toFixed(2);
  document.getElementById('combo-discount-x3').value = (cs.discountX3 * 100).toFixed(2);
}

/** Verde ≥30%, amarillo entre 25% y 30%, rojo <25% (ver pedido del usuario). */
function comboProfitClass(pct) {
  if (pct >= 0.3) return 'profit-green';
  if (pct >= 0.25) return 'profit-yellow';
  return 'profit-red';
}

const COMBO_TABLE_COLUMNS = [
  'Pedido',
  'Precio total',
  'Precio/cuadro',
  'Desc. vs individual',
  'Costo total',
  'Ganancia neta',
  'Ganancia/cuadro',
  '% s/precio',
  '% s/costo',
];

function renderCombosTables() {
  const container = document.getElementById('combos-tables');
  container.innerHTML = '';
  const sizes = state.combos?.sizes || {};

  for (const size of COMBO_SIZES) {
    const data = sizes[size];
    if (!data) continue;

    const heading = document.createElement('h3');
    heading.textContent = size;
    container.appendChild(heading);

    if (data.missing) {
      const warn = document.createElement('p');
      warn.className = 'muted';
      warn.textContent = data.warning;
      container.appendChild(warn);
      continue;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const col of COMBO_TABLE_COLUMNS) {
      const th = document.createElement('th');
      th.textContent = col;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of data.rows) {
      const tr = document.createElement('tr');

      const labelTd = document.createElement('td');
      labelTd.textContent = row.label;
      tr.appendChild(labelTd);

      const priceTotalTd = document.createElement('td');
      priceTotalTd.textContent = fmt.format(row.priceTotal);
      tr.appendChild(priceTotalTd);

      const pricePerUnitTd = document.createElement('td');
      pricePerUnitTd.textContent = fmt.format(row.pricePerUnit);
      tr.appendChild(pricePerUnitTd);

      const discountTd = document.createElement('td');
      discountTd.textContent = pctFmt(row.discountVsIndividual);
      tr.appendChild(discountTd);

      const costTotalTd = document.createElement('td');
      costTotalTd.textContent = fmt.format(row.costTotal);
      tr.appendChild(costTotalTd);

      const profitTd = document.createElement('td');
      profitTd.textContent = fmt.format(row.profit);
      tr.appendChild(profitTd);

      const profitPerUnitTd = document.createElement('td');
      profitPerUnitTd.textContent = fmt.format(row.profitPerUnit);
      tr.appendChild(profitPerUnitTd);

      const profitPctPriceTd = document.createElement('td');
      profitPctPriceTd.textContent = pctFmt(row.profitPctOnPrice);
      profitPctPriceTd.className = comboProfitClass(row.profitPctOnPrice);
      tr.appendChild(profitPctPriceTd);

      const profitPctCostTd = document.createElement('td');
      profitPctCostTd.textContent = pctFmt(row.profitPctOnCost);
      tr.appendChild(profitPctCostTd);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);
    container.appendChild(wrapper);
  }
}

function effectiveInputsFor(product) {
  const overrides = product.overrides || {};
  return {
    cost: product.cost,
    shipping: product.shipping,
    fixedCostPerUnit: state.expenseSummary.fixedCostPerUnit,
    // El envío del pedido activo y los gastos "por pedido" se suman como
    // costo variable más, igual que los gastos "por unidad" (para un
    // producto individual, 1 pedido = 1 unidad). Ninguno de los dos viene
    // incluido en expenseSummary porque ese viene de /api/expenses, que no
    // sabe nada de pedidos al proveedor.
    variableCostPerUnit:
      state.expenseSummary.totalVariablePerUnit +
      state.expenseSummary.totalVariablePerOrder +
      state.supplierShippingPerUnit,
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

document.getElementById('add-order-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-order-name').value;
  const date = document.getElementById('new-order-date').value;
  const shippingCost = document.getElementById('new-order-shipping').value;
  const totalUnits = document.getElementById('new-order-units').value;
  await api('/api/orders', {
    method: 'POST',
    body: JSON.stringify({ name, date, shippingCost, totalUnits }),
  });
  e.target.reset();
  await loadAll();
});

document.getElementById('add-ad-charge-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = document.getElementById('new-ad-charge-date').value;
  const amount = document.getElementById('new-ad-charge-amount').value;
  const note = document.getElementById('new-ad-charge-note').value;
  try {
    await api('/api/ad-spend/charges', {
      method: 'POST',
      body: JSON.stringify({ date, amount, note }),
    });
    e.target.reset();
    await loadAll();
  } catch (err) {
    alert(`No se pudo agregar la carga: ${err.message}`);
  }
});

document.getElementById('combo-settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/api/combos', {
    method: 'PUT',
    body: JSON.stringify({
      individualPrices: {
        '20x30': Number(document.getElementById('combo-price-20x30').value) || 0,
        '30x40': Number(document.getElementById('combo-price-30x40').value) || 0,
        '40x50': Number(document.getElementById('combo-price-40x50').value) || 0,
      },
      discountX2: fractionFromPercentInput(document.getElementById('combo-discount-x2').value),
      discountX3: fractionFromPercentInput(document.getElementById('combo-discount-x3').value),
    }),
  });
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
