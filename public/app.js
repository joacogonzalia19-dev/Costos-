import { calculateSuggestedPrice } from '/shared/pricing.mjs';

const fmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });
const pctFmt = (fraction) => `${(fraction * 100).toFixed(1)}%`;

const state = {
  settings: null,
  products: [],
  configured: false,
  tiendanubeConfig: null,
  oauthConfig: null,
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
  const [settings, statusResp, productsResp, tnConfig, oauthConfig] = await Promise.all([
    api('/api/settings'),
    api('/api/tiendanube/status'),
    api('/api/products'),
    api('/api/tiendanube/config'),
    api('/api/tiendanube/oauth-config'),
  ]);
  state.settings = settings;
  state.configured = statusResp.configured;
  state.products = productsResp.products;
  state.tiendanubeConfig = tnConfig;
  state.oauthConfig = oauthConfig;
  renderStatus();
  renderSettingsForm();
  renderTiendaNubeForm();
  renderOAuthForm();
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
    nameTd.innerHTML = `${product.name}<br><span class="small-muted">${product.source === 'tiendanube' ? 'Tienda Nube' : 'Manual'}</span>`;
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
    saveBtn.textContent = 'Guardar costos';
    saveBtn.onclick = async () => {
      await api(`/api/products/${product.id}/costs`, {
        method: 'PUT',
        body: JSON.stringify({
          cost: costInput.value,
          shipping: shippingInput.value,
          overrides: product.overrides || {},
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

renderOAuthFlash();
loadAll().catch((err) => {
  console.error(err);
  alert(`No se pudo cargar la app: ${err.message}`);
});
