// Motor de cálculo de precios y costos.
// Módulo puro (sin dependencias de Node ni del navegador) para poder
// importarlo tanto desde el backend (Express) como desde el frontend
// (<script type="module">), garantizando que ambos lados calculen exactamente igual.

/**
 * @typedef {Object} PricingInputs
 * @property {number} cost                Costo del producto (compra/fabricación), en la moneda de la tienda.
 * @property {number} shipping            Costo de envío/empaque específico de este producto.
 * @property {number} fixedCostPerUnit    Gastos fijos del negocio (alquiler, herramientas, etc.) ya
 *                                         prorrateados por unidad — un monto en pesos, no un %,
 *                                         porque un gasto fijo no crece si subís el precio.
 * @property {number} variableCostPerUnit Gastos variables generales del negocio (packaging genérico,
 *                                         insumos que se usan en todas las ventas), en pesos por unidad.
 * @property {number} paymentFeePct       Comisión de medios de pago, como fracción (0.06 = 6%).
 * @property {number} taxPct              Impuestos (IVA, IIBB, etc.), como fracción.
 * @property {number} marginPct           Margen de ganancia deseado sobre el precio final, como fracción.
 */

/** Suma los tres porcentajes que se aplican sobre el precio final (no sobre el costo). */
function totalPercentage({ paymentFeePct, taxPct, marginPct }) {
  return (paymentFeePct || 0) + (taxPct || 0) + (marginPct || 0);
}

/**
 * Calcula el precio de venta sugerido a partir de los costos y el margen deseado.
 *
 * La comisión, los impuestos y el margen se aplican sobre el PRECIO FINAL, no sobre
 * el costo — así es como funcionan en la realidad (Tienda Nube/Mercado Pago cobran su
 * comisión sobre lo que paga el cliente, no sobre tu costo). En cambio, los gastos
 * fijos y variables del negocio son montos en pesos: no "crecen" si el precio sube,
 * así que van sumados directo al costo base, junto con costo y envío.
 *
 * Por eso la fórmula despeja el precio de:
 *
 *   precio = costo + envío + gastosFijosPorUnidad + gastosVariablesPorUnidad
 *            + comisión*precio + impuestos*precio + margen*precio
 *
 * @param {PricingInputs} inputs
 * @returns {{ ok: true, price: number, breakdown: object, totalPct: number } | { ok: false, error: string, totalPct: number }}
 */
export function calculateSuggestedPrice(inputs) {
  const cost = Number(inputs.cost) || 0;
  const shipping = Number(inputs.shipping) || 0;
  const fixedCostPerUnit = Number(inputs.fixedCostPerUnit) || 0;
  const variableCostPerUnit = Number(inputs.variableCostPerUnit) || 0;
  const paymentFeePct = Number(inputs.paymentFeePct) || 0;
  const taxPct = Number(inputs.taxPct) || 0;
  const marginPct = Number(inputs.marginPct) || 0;

  const totalPct = totalPercentage({ paymentFeePct, taxPct, marginPct });

  if (totalPct >= 1) {
    return {
      ok: false,
      error:
        'La suma de comisión + impuestos + margen es 100% o más del precio. ' +
        'Bajá alguno de esos porcentajes para poder calcular un precio.',
      totalPct,
    };
  }

  const baseCost = cost + shipping + fixedCostPerUnit + variableCostPerUnit;
  const price = baseCost / (1 - totalPct);

  return {
    ok: true,
    price,
    totalPct,
    breakdown: {
      cost,
      shipping,
      fixedCostPerUnit,
      variableCostPerUnit,
      paymentFeeAmount: price * paymentFeePct,
      taxAmount: price * taxPct,
      marginAmount: price * marginPct,
    },
  };
}

/**
 * Dado un precio (por ejemplo, el precio actual que ya tiene publicado en la tienda),
 * calcula cuánto se lleva cada concepto y qué margen neto realmente queda.
 * Útil para revisar productos ya publicados sin tener que recalcular el precio.
 *
 * @param {number} price
 * @param {Omit<PricingInputs, 'marginPct'>} inputs
 */
export function calculateBreakdownForPrice(price, inputs) {
  const p = Number(price) || 0;
  const cost = Number(inputs.cost) || 0;
  const shipping = Number(inputs.shipping) || 0;
  const fixedCostPerUnit = Number(inputs.fixedCostPerUnit) || 0;
  const variableCostPerUnit = Number(inputs.variableCostPerUnit) || 0;
  const paymentFeePct = Number(inputs.paymentFeePct) || 0;
  const taxPct = Number(inputs.taxPct) || 0;

  const paymentFeeAmount = p * paymentFeePct;
  const taxAmount = p * taxPct;

  const marginAmount = p - cost - shipping - fixedCostPerUnit - variableCostPerUnit - paymentFeeAmount - taxAmount;
  const marginPct = p > 0 ? marginAmount / p : 0;

  return {
    price: p,
    marginAmount,
    marginPct,
    breakdown: {
      cost,
      shipping,
      fixedCostPerUnit,
      variableCostPerUnit,
      paymentFeeAmount,
      taxAmount,
      marginAmount,
    },
  };
}

/**
 * Calcula precio, costo y ganancia de un "pedido" de combo (vender N cuadros
 * de la misma medida juntos, con un descuento sobre el precio individual).
 *
 * A diferencia de calculateSuggestedPrice (que DESPEJA el precio a partir de
 * un margen deseado), acá el precio ya está definido (individual × cantidad ×
 * descuento) y lo que se calcula es la ganancia que deja ese precio — por eso
 * la comisión y los impuestos se calculan directo sobre ese precio, sin
 * necesidad de despejar nada.
 *
 * Distingue gastos "por unidad" (se multiplican por la cantidad de cuadros
 * del pedido) de gastos "por pedido" (fijos del negocio ya prorrateados, y
 * gastos variables marcados como "por pedido": se cobran una sola vez,
 * sin importar si el pedido es de 1, 2 o 3 cuadros).
 *
 * @param {Object} inputs
 * @param {number} inputs.individualPrice   Precio de venta de un cuadro suelto de esta medida.
 * @param {number} inputs.quantity          Cantidad de cuadros del pedido (1, 2 o 3).
 * @param {number} inputs.discount          Descuento sobre el precio individual, como fracción (0.10 = 10%).
 * @param {number} inputs.costPerUnit       Costo de compra de un cuadro de esta medida.
 * @param {number} inputs.supplierShippingPerUnit Envío del pedido al proveedor activo, por unidad.
 * @param {number} inputs.variablePerUnit   Gastos variables "por unidad" (se multiplican por la cantidad).
 * @param {number} inputs.variablePerOrder  Gastos variables "por pedido" (se cobran una sola vez).
 * @param {number} inputs.fixedPerOrder     Gastos fijos ya prorrateados (una "venta" = un pedido acá).
 * @param {number} inputs.paymentFeePct     Comisión de medios de pago, como fracción.
 * @param {number} inputs.taxPct            Impuestos, como fracción.
 */
export function calculateComboRow(inputs) {
  const individualPrice = Number(inputs.individualPrice) || 0;
  const quantity = Number(inputs.quantity) || 0;
  const discount = Number(inputs.discount) || 0;
  const costPerUnit = Number(inputs.costPerUnit) || 0;
  const supplierShippingPerUnit = Number(inputs.supplierShippingPerUnit) || 0;
  const variablePerUnit = Number(inputs.variablePerUnit) || 0;
  const variablePerOrder = Number(inputs.variablePerOrder) || 0;
  const fixedPerOrder = Number(inputs.fixedPerOrder) || 0;
  const paymentFeePct = Number(inputs.paymentFeePct) || 0;
  const taxPct = Number(inputs.taxPct) || 0;

  const priceTotal = Math.round(individualPrice * quantity * (1 - discount));
  const pricePerUnit = quantity > 0 ? priceTotal / quantity : 0;
  const discountVsIndividual = individualPrice > 0 ? 1 - pricePerUnit / individualPrice : 0;

  const costTotal =
    quantity * (costPerUnit + supplierShippingPerUnit + variablePerUnit) +
    variablePerOrder +
    fixedPerOrder +
    priceTotal * (paymentFeePct + taxPct);

  const profit = priceTotal - costTotal;
  const profitPerUnit = quantity > 0 ? profit / quantity : 0;
  const profitPctOnPrice = priceTotal > 0 ? profit / priceTotal : 0;
  const profitPctOnCost = costTotal > 0 ? profit / costTotal : 0;

  return {
    priceTotal,
    pricePerUnit,
    discountVsIndividual,
    costTotal,
    profit,
    profitPerUnit,
    profitPctOnPrice,
    profitPctOnCost,
  };
}
