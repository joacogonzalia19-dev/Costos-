import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSuggestedPrice, calculateBreakdownForPrice } from '../shared/pricing.mjs';

test('calculateSuggestedPrice: caso típico da un precio que reproduce el margen pedido', () => {
  const result = calculateSuggestedPrice({
    cost: 1000,
    shipping: 200,
    fixedCostPerUnit: 50,
    variableCostPerUnit: 30,
    paymentFeePct: 0.06,
    taxPct: 0,
    marginPct: 0.3,
  });

  assert.equal(result.ok, true);
  // (1000 + 200 + 50 + 30) / (1 - 0.06 - 0.3) = 1280 / 0.64
  assert.ok(Math.abs(result.price - 1280 / 0.64) < 1e-9);

  // El margen en pesos debe ser exactamente 30% del precio calculado.
  assert.ok(Math.abs(result.breakdown.marginAmount - result.price * 0.3) < 1e-9);

  // Costo + envío + gastos fijos/variables + comisión + margen debe reconstruir el precio.
  const sum =
    result.breakdown.cost +
    result.breakdown.shipping +
    result.breakdown.fixedCostPerUnit +
    result.breakdown.variableCostPerUnit +
    result.breakdown.paymentFeeAmount +
    result.breakdown.taxAmount +
    result.breakdown.marginAmount;
  assert.ok(Math.abs(sum - result.price) < 1e-6);
});

test('calculateSuggestedPrice: porcentajes que suman 100% o más da error', () => {
  const result = calculateSuggestedPrice({
    cost: 100,
    shipping: 0,
    paymentFeePct: 0.5,
    taxPct: 0.3,
    marginPct: 0.3,
  });
  assert.equal(result.ok, false);
  assert.ok(result.error.length > 0);
});

test('calculateSuggestedPrice: sin costos ni porcentajes da precio 0', () => {
  const result = calculateSuggestedPrice({
    cost: 0,
    shipping: 0,
    fixedCostPerUnit: 0,
    variableCostPerUnit: 0,
    paymentFeePct: 0,
    taxPct: 0,
    marginPct: 0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.price, 0);
});

test('calculateBreakdownForPrice: detecta cuando un precio ya publicado da pérdida', () => {
  const result = calculateBreakdownForPrice(1000, {
    cost: 900,
    shipping: 100,
    fixedCostPerUnit: 0,
    variableCostPerUnit: 0,
    paymentFeePct: 0.06,
    taxPct: 0,
  });
  // 1000 - 900 - 100 - 60 = -60 -> está perdiendo plata
  assert.ok(result.marginAmount < 0);
  assert.ok(result.marginPct < 0);
});

test('calculateBreakdownForPrice: es consistente con calculateSuggestedPrice (round-trip)', () => {
  const inputs = {
    cost: 500,
    shipping: 150,
    fixedCostPerUnit: 40,
    variableCostPerUnit: 20,
    paymentFeePct: 0.065,
    taxPct: 0.02,
    marginPct: 0.25,
  };
  const suggested = calculateSuggestedPrice(inputs);
  assert.equal(suggested.ok, true);

  const check = calculateBreakdownForPrice(suggested.price, inputs);
  assert.ok(Math.abs(check.marginPct - inputs.marginPct) < 1e-9);
});

test('calculateSuggestedPrice: los gastos fijos/variables por unidad se suman al costo base, no al %', () => {
  const withoutExtras = calculateSuggestedPrice({
    cost: 1000,
    shipping: 0,
    paymentFeePct: 0.06,
    taxPct: 0,
    marginPct: 0.3,
  });
  const withExtras = calculateSuggestedPrice({
    cost: 1000,
    shipping: 0,
    fixedCostPerUnit: 100,
    variableCostPerUnit: 50,
    paymentFeePct: 0.06,
    taxPct: 0,
    marginPct: 0.3,
  });
  // La diferencia de precio debe ser exactamente (100+50) repartido sobre el mismo
  // denominador (1 - 0.36), no proporcional al precio total.
  const expectedDiff = 150 / (1 - 0.36);
  assert.ok(Math.abs(withExtras.price - withoutExtras.price - expectedDiff) < 1e-9);
});
