# Costos-

Esta app ayuda a calcular el precio de venta de tus productos: a partir del
costo, el envío, la comisión de pago, los impuestos y el margen que querés
ganar, calcula el precio final — y te muestra en pesos cuánto se lleva cada
concepto.

Es una calculadora **standalone**: no se conecta a ninguna tienda ni
servicio externo. Cargás tus productos a mano y listo.

## ¿Por qué esta fórmula?

La comisión de pago, los impuestos y el margen se calculan casi siempre sobre
el **precio final** que paga el cliente, no sobre tu costo. Por eso el precio
sugerido se calcula despejando:

```
precio = costo + envío + (comisión% + impuestos% + costosFijos% + margen%) × precio
```

Esto evita el error común de aplicar el margen sobre el costo y terminar
ganando menos de lo pensado una vez que se descuentan las comisiones.

La lógica completa está en [`shared/pricing.mjs`](shared/pricing.mjs) y tiene
tests en [`tests/pricing.test.mjs`](tests/pricing.test.mjs).

## Instalación

```bash
npm install
npm start
```

Abrí http://localhost:3000

## Cómo se usa

1. En **"Ajustes por defecto"** configurás los porcentajes que se aplican a
   todos los productos: comisión de pago, impuestos, costos fijos/publicidad
   y el margen de ganancia que querés.
2. En **"Agregar producto"** cargás nombre, costo y envío/empaque de cada
   producto.
3. En la tabla de **"Productos"** vas a ver el precio de venta sugerido y
   cuánto queda de margen neto en pesos. Podés editar costo/nombre por
   producto y guardar, o eliminarlo.

Todo se guarda localmente en `data/` (ver "Estructura del proyecto" abajo);
no sale de tu máquina.

## Ajustes por defecto

- **Comisión de pago (%)**: lo que te cobra tu pasarela de pagos.
- **Impuestos (%)**: IVA, Ingresos Brutos, etc. (0% si sos monotributista y
  no discriminás IVA).
- **Costos fijos / publicidad (%)**: para prorratear gastos fijos por venta.
- **Margen deseado (%)**: cuánto querés ganar, sobre el precio final.

Estos valores se aplican a todos los productos por defecto. La estructura de
datos ya soporta overrides por producto (`data/products.json`); una próxima
mejora natural es exponer esos overrides en la interfaz fila por fila.

## Estructura del proyecto

```
shared/pricing.mjs   Motor de cálculo puro (compartido por backend y frontend)
server/              Backend Express: rutas de API y persistencia
public/              Frontend (HTML/CSS/JS sin build step)
data/                Ajustes y productos guardados localmente (no se versiona)
tests/               Tests del motor de cálculo (`npm test`)
```

## Roadmap sugerido

- [ ] Overrides de porcentaje por producto en la interfaz (hoy sólo por API).
- [ ] Simulación de "cuotas" (costo financiero de tarjeta a distintos plazos).
- [ ] Exportar/importar productos (CSV) para cargar varios de una.
