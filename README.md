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
el **precio final** que paga el cliente, no sobre tu costo. En cambio, los
gastos del negocio (ver "Gastos del negocio" más abajo) son montos en pesos:
un gasto fijo no "crece" porque subas el precio, así que se suman directo al
costo, junto con el costo del producto y el envío. Por eso el precio sugerido
se calcula despejando:

```
precio = costo + envío + gastosFijosPorUnidad + gastosVariablesPorUnidad
         + (comisión% + impuestos% + margen%) × precio
```

Esto evita el error común de aplicar el margen sobre el costo y terminar
ganando menos de lo pensado una vez que se descuentan las comisiones, y
también evita subestimar cuánto hay que cobrar para cubrir los gastos fijos
del negocio (herramientas, publicidad, etc.), no sólo el costo del producto.

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

## Cómo se usa

1. En **"Ajustes por defecto"** configurás la comisión de pago, los
   impuestos, el margen de ganancia que querés, y cuántas **ventas estimás
   por mes** (se usa para repartir los gastos fijos, ver el punto 2).
2. En **"Gastos del negocio"** cargás todo lo que gastás en el negocio:
   producción, packaging, publicidad, herramientas digitales (Canva,
   WhatsApp Business API, etc.), alquiler, lo que sea. Cada gasto se marca
   como **Fijo (mensual)** — se reparte entre las ventas estimadas del
   punto 1 para saber cuánto le toca a cada unidad — o **Variable (por
   unidad)** — un monto que se suma igual a todas las ventas (ej. una
   tarjetita que va en cada pedido). La app muestra el total y cuánto
   termina siendo por unidad, y ese monto se suma automáticamente al costo
   de cada producto sin que tengas que hacer la cuenta a mano.
3. En **"Agregar producto manual"** cargás nombre, costo y envío/empaque de
   productos que no vengan de Tienda Nube (o para simular antes de conectar).
4. En la tabla de **"Productos"** vas a ver el precio de venta sugerido y
   cuánto queda de margen neto en pesos. Podés editar costo/envío por
   producto y guardar, o eliminarlo (los manuales).
5. Si un producto puntual necesita otro % (por ejemplo, un proveedor con
   comisión distinta o un margen más chico para vender más rápido), apretá
   **"Ajustes propios"** en esa fila: podés pisar la comisión, los
   impuestos o el margen sólo para ese producto (dejar vacío = usa el
   default). Un ⚙ al lado del nombre indica que el producto tiene ajustes
   propios.

## Conectar tu tienda de Tienda Nube (opcional)

Hay dos formas de conectar, según tu plan. Ambas se hacen desde la sección
**"Conectar Tienda Nube"** de la app — no hace falta editar archivos ni
reiniciar el servidor.

### Opción 1: OAuth vía Partner Portal (cualquier plan)

**"Aplicaciones a medida" es exclusivo de los planes Escala/Evolución.** Si
tu tienda está en un plan más chico (Inicial, Esencial, Impulso), usá esta
opción — es el mismo mecanismo que usa cualquier app de la tienda de
aplicaciones, y funciona en cualquier plan.

1. Creá una cuenta gratuita en el
   [Partner Portal de Tienda Nube](https://partners.tiendanube.com).
2. Ahí, **"Crear aplicación"** → elegí el tipo pensado para uso propio (no
   para publicar en la tienda de aplicaciones).
3. En **"Access Keys"** vas a ver el **Client ID** (app_id) y **Client
   Secret** de tu app.
4. Configurá el **Redirect URL** de esa app para que apunte a
   `<url-donde-corre-esta-app>/oauth/callback` (si la corrés en tu máquina
   con el puerto por defecto: `http://localhost:3000/oauth/callback`).
5. Volvé a la app de Costos-, pegá el Client ID y Client Secret en
   "Opción 1: Conectar con Tienda Nube", apretá **"Guardar datos de la
   app"** y después **"Conectar con Tienda Nube"**.
6. Te va a redirigir a Tienda Nube para loguearte (con las credenciales de
   tu tienda) y aprobar los permisos. Al aceptar, volvés a la app ya
   conectada — el Store ID y el Access Token se guardan solos.

### Opción 2: Aplicación a medida (sólo planes Escala/Evolución)

Si tu plan sí incluye esta función, es más directo (sin Partner Portal):

1. En el panel de administración de tu tienda, menú lateral
   **"Aplicaciones a medida"** → **"Crear aplicación a medida"**.
2. Ponele un nombre descriptivo y en **"Perfiles de acceso"** elegí sólo
   los permisos de **Productos** (lectura y modificación) — evitá "Acceso
   completo" salvo que lo necesites.
3. Guardá. Tienda Nube genera el token automáticamente. Apretá **"Revelar"**
   y **"Copiar token"** — **sólo se muestra completo esa vez**; si lo
   perdés hay que revocarlo y crear uno nuevo.
4. Conseguí también tu **Store ID** (no aparece en esa pantalla): entrá a
   tu tienda pública (botón "Visitar tienda"), click derecho → "Ver código
   fuente" (Ctrl+U), buscá `LS.store = {` con Ctrl+F, y ahí vas a ver el
   `id` numérico de tu tienda.
5. En "Opción 2: Aplicación a medida" de la app, pegá el Store ID y el
   Access Token, junto con un User-Agent que te identifique (Tienda Nube
   lo pide para poder contactarte si hay un problema, ej.
   `Costos- App (tu-email@ejemplo.com)`).
6. Apretá **"Guardar credenciales"** y después **"Probar conexión"**.

Con cualquiera de las dos, si todo salió bien arriba a la derecha va a decir
"Tienda Nube conectada" y vas a ver tus productos reales.

Las credenciales se guardan en `data/tiendanube.json`, un archivo local que
está en `.gitignore` — nunca se commitea ni sale de tu servidor. La interfaz
nunca vuelve a mostrar el Access Token ni el Client Secret una vez
guardados (sólo indica si hay uno cargado); si querés cambiarlos, simplemente
pegá uno nuevo.

Como alternativa (por ejemplo para un despliegue sin interfaz), también se
pueden definir `TN_STORE_ID`, `TN_ACCESS_TOKEN`, `TN_USER_AGENT`,
`TN_CLIENT_ID` y `TN_CLIENT_SECRET` en `.env` — se usan como respaldo si no
hay nada guardado desde la app.

Importante: Tienda Nube no tiene un campo de "costo" ni "margen" por
producto, así que esos datos se guardan localmente en `data/products.json`
(no se suben a tu tienda). Lo único que la app escribe de vuelta en Tienda
Nube es el **precio de venta**, y sólo cuando apretás "Aplicar en Tienda
Nube" — nunca automáticamente.

## Ajustes por defecto

- **Comisión de pago (%)**: lo que te cobra tu pasarela de pagos.
- **Impuestos (%)**: IVA, Ingresos Brutos, etc. (0% si sos monotributista y
  no discriminás IVA, o si todavía no estás inscripto en ningún régimen).
- **Margen deseado (%)**: cuánto querés ganar, sobre el precio final.
- **Ventas estimadas por mes**: se usa sólo para repartir los gastos fijos
  del negocio (ver "Gastos del negocio" abajo) entre esa cantidad de
  unidades.

Estos valores se aplican a todos los productos por defecto, salvo que el
producto tenga sus propios "Ajustes propios" (ver "Cómo se usa" arriba).

## Gastos del negocio

Es habitual subestimar cuánto hay que cobrar por producto porque sólo se
tiene en cuenta el costo de fabricarlo/comprarlo, sin sumar lo que cuesta
sostener el negocio en general (herramientas, publicidad, etc.). Esta
sección resuelve eso:

- **Gastos fijos** (ej. suscripción a una herramienta, presupuesto mensual
  de publicidad, alquiler): se cargan como monto mensual. La app los suma
  todos y los divide por las "Ventas estimadas por mes" de Ajustes, para
  saber cuánto de ese gasto le corresponde a cada unidad vendida.
- **Gastos variables** (ej. un insumo que se usa en cada pedido sin importar
  qué producto sea): se cargan como monto por unidad directo, y se suman
  igual a todas las ventas.

Ambos montos (ya prorrateados) se suman automáticamente al costo de cada
producto al calcular el precio sugerido — no hace falta tocar nada más.

## Estructura del proyecto

```
shared/pricing.mjs   Motor de cálculo puro (compartido por backend y frontend)
server/              Backend Express: rutas de API, cliente de Tienda Nube, persistencia
public/              Frontend (HTML/CSS/JS sin build step)
data/                Costos, productos manuales y credenciales guardadas localmente (no se versiona)
tests/               Tests del motor de cálculo (`npm test`)
```

## Roadmap sugerido

- [ ] Historial de precios aplicados en Tienda Nube.
- [ ] Simulación de "cuotas" (costo financiero de tarjeta a distintos plazos).
- [ ] Alertas cuando el precio actual en Tienda Nube da margen negativo.
