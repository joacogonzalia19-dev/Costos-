# Costos-

Esta app ayuda a calcular el precio de venta de tus productos: a partir del
costo, el envío, la comisión de pago, los impuestos y el margen que querés
ganar, calcula el precio final — y te muestra en pesos cuánto se lleva cada
concepto.

Pensada para **Ballon** (o cualquier tienda), con integración opcional a
**Tienda Nube**: si conectás tu tienda, trae tus productos reales y puede
actualizar el precio de venta con un click. Sin conexión, funciona igual como
calculadora manual.

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
cp .env.example .env
npm start
```

Abrí http://localhost:3000

Sin conectar nada, la app arranca en **modo manual**: no toca ninguna tienda
real, y podés cargar productos a mano para probar la calculadora.

## Conectar tu tienda de Tienda Nube (opcional)

Se hace directamente desde la app, en la sección **"Conectar Tienda Nube"**
— no hace falta editar archivos ni reiniciar el servidor:

1. En el panel de administración de tu tienda, andá al menú lateral
   **"Aplicaciones a medida"** → **"Crear aplicación a medida"**.
2. Ponele un nombre descriptivo (ej. "Costos- App") y en **"Perfiles de
   acceso"** elegí sólo los permisos de **Productos** (lectura y
   modificación) — evitá "Acceso completo" salvo que lo necesites.
3. Guardá. Tienda Nube genera el token automáticamente. Apretá **"Revelar"**
   y **"Copiar token"** — **sólo se muestra completo esa vez**; si lo
   perdés hay que revocarlo y crear uno nuevo.
4. Conseguí también tu **Store ID** (no aparece en esa pantalla): entrá a
   tu tienda pública (botón "Visitar tienda"), hacé click derecho → "Ver
   código fuente" (Ctrl+U), buscá `LS.store = {` con Ctrl+F, y ahí vas a
   ver el `id` numérico de tu tienda.
5. Volvé a la app de Costos-, pegá el Store ID y el Access Token en el
   formulario **"Conectar Tienda Nube"**, junto con un User-Agent que te
   identifique (Tienda Nube lo pide para poder contactarte si hay un
   problema, ej. `Costos- App (tu-email@ejemplo.com)`).
6. Apretá **"Guardar credenciales"** y después **"Probar conexión"** para
   confirmar que están bien. Si todo OK, arriba a la derecha va a decir
   "Tienda Nube conectada" y vas a ver tus productos reales.

Las credenciales se guardan en `data/tiendanube.json`, un archivo local que
está en `.gitignore` — nunca se commitea ni sale de tu servidor. La interfaz
nunca vuelve a mostrar el Access Token una vez guardado (sólo indica si hay
uno cargado); si querés cambiarlo, simplemente pegá uno nuevo.

Como alternativa (por ejemplo para un despliegue sin interfaz), también se
pueden definir `TN_STORE_ID`, `TN_ACCESS_TOKEN` y `TN_USER_AGENT` en `.env`
— se usan como respaldo si no hay nada guardado desde la app.

Importante: Tienda Nube no tiene un campo de "costo" ni "margen" por
producto, así que esos datos se guardan localmente en `data/products.json`
(no se suben a tu tienda). Lo único que la app escribe de vuelta en Tienda
Nube es el **precio de venta**, y sólo cuando apretás "Aplicar en Tienda
Nube" — nunca automáticamente.

## Ajustes por defecto

Desde la sección "Ajustes por defecto" configurás:

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
server/              Backend Express: rutas de API, cliente de Tienda Nube, persistencia
public/              Frontend (HTML/CSS/JS sin build step)
data/                Costos y productos manuales guardados localmente (no se versiona)
tests/               Tests del motor de cálculo (`npm test`)
```

## Roadmap sugerido

- [ ] Overrides de porcentaje por producto en la interfaz (hoy sólo por API).
- [ ] Historial de precios aplicados.
- [ ] Simulación de "cuotas" (costo financiero de tarjeta a distintos plazos).
- [ ] Alertas cuando el precio actual en Tienda Nube da margen negativo.
