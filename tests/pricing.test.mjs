import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSuggestedPrice, calculateBreakdownForPrice } from '../shared/pricing.mjs';

test('calculateSuggestedPrice: caso típico da un precio que reproduce el margen pedido', () => {
  const result = calculateSuggestedPrice({
    cost: 1000,
    shipping: 200,
    paymentFeePct: 0.06,
    taxPct: 0,
    fixedCostPct: 0.05,
    marginPct: 0.3,
  });

  assert.equal(result.ok, true);
  // (1000 + 200) / (1 - 0.06 - 0.05 - 0.3) = 1200 / 0.59
  assert.ok(Math.abs(result.price - 1200 / 0.59) < 1e-9);

  // El margen en pesos debe ser exactamente 30% del precio calculado.
  assert.ok(Math.abs(result.breakdown.marginAmount - result.price * 0.3) < 1e-9);

  // Costo + envío + todos los descuentos + margen debe reconstruir el precio.
  const sum =
    result.breakdown.cost +
    result.breakdown.shipping +
    result.breakdown.paymentFeeAmount +
    result.breakdown.taxAmount +
    result.breakdown.fixedCostAmount +
    result.breakdown.marginAmount;
  assert.ok(Math.abs(sum - result.price) < 1e-6);
});

test('calculateSuggestedPrice: porcentajes que suman 100% o más da error', () => {
  const result = calculateSuggestedPrice({
    cost: 100,
    shipping: 0,
    paymentFeePct: 0.5,
    taxPct: 0.3,
    fixedCostPct: 0.1,
    marginPct: 0.2,
  });
  assert.equal(result.ok, false);
  assert.ok(result.error.length > 0);
});

test('calculateSuggestedPrice: sin costos ni porcentajes da precio 0', () => {
  const result = calculateSuggestedPrice({
    cost: 0,
    shipping: 0,
    paymentFeePct: 0,
    taxPct: 0,
    fixedCostPct: 0,
    marginPct: 0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.price, 0);
});

test('calculateBreakdownForPrice: detecta cuando un precio ya publicado da pérdida', () => {
  const result = calculateBreakdownForPrice(1000, {
    cost: 900,
    shipping: 100,
    paymentFeePct: 0.06,
    taxPct: 0,
    fixedCostPct: 0,
  });
  // 1000 - 900 - 100 - 60 = -60 -> está perdiendo plata
  assert.ok(result.marginAmount < 0);
  assert.ok(result.marginPct < 0);
});

test('calculateBreakdownForPrice: es consistente con calculateSuggestedPrice (round-trip)', () => {
  const inputs = {
    cost: 500,
    shipping: 150,
    paymentFeePct: 0.065,
    taxPct: 0.02,
    fixedCostPct: 0.03,
    marginPct: 0.25,
  };
  const suggested = calculateSuggestedPrice(inputs);
  assert.equal(suggested.ok, true);

  const check = calculateBreakdownForPrice(suggested.price, inputs);
  assert.ok(Math.abs(check.marginPct - inputs.marginPct) < 1e-9);
});
