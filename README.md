# Costos-

Esta app ayuda a calcular el precio de venta de tus productos: a partir del
costo, el envío, la comisión de pago, los impuestos y el margen que querés
ganar, calcula el precio final — y te muestra en pesos cuánto se lleva cada
concepto.

Pensada para **Ballon** (o cualquier tienda), con integración opcional a
**Tienda Nube**: si conectás tu tienda, trae tus productos reales y puede
actualizar el precio de venta con un click. Sin conexión, funciona igual como
calculadora manual.

🔗 **App online:** https://calculadora-costos-delta.vercel.app (pide la
contraseña configurada en `APP_PASSWORD`).

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

## Instalación (para correrla en tu máquina)

La app necesita una base de datos (Upstash Redis, gratis) y una contraseña
propia incluso para correrla en local — así el mismo código funciona igual
acá que desplegado online. Ver **"Desplegar online (Vercel)"** más abajo
para los pasos de crear la base de datos.

```bash
npm install
cp .env.example .env
# completá UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, APP_PASSWORD
# y SESSION_SECRET en el .env recién creado
npm start
```

Abrí http://localhost:3000, ingresá la contraseña que pusiste en
`APP_PASSWORD`, y ya estás adentro. Sin conectar Tienda Nube, la app queda en
**modo manual**: podés cargar productos a mano para probar la calculadora.

## Desplegar online (Vercel)

Así queda en un link fijo, accesible desde cualquier lado sin depender de tu
computadora. Vercel no tiene almacenamiento local persistente, por eso los
datos se guardan en una base de datos (Upstash Redis) en vez de en archivos.

### 1. Crear la base de datos (Upstash)

La forma más simple es hacerlo directamente desde Vercel en el paso 3 (el
marketplace de Vercel crea la base y carga las variables solo). Si preferís
crearla antes por separado: entrá a
[console.upstash.com](https://console.upstash.com), creá una cuenta gratis,
**"Create Database"** (tipo Redis, plan gratis), y copiá de la pestaña
**"REST API"** las dos variables `UPSTASH_REDIS_REST_URL` y
`UPSTASH_REDIS_REST_TOKEN`.

### 2. Subir el código a GitHub

Si ya lo tenés en un repo de GitHub (como este), pasás directo al paso 3.

### 3. Importar el proyecto en Vercel

1. Entrá a [vercel.com](https://vercel.com) y creá una cuenta gratis
   (podés entrar directo con tu cuenta de GitHub).
2. **"Add New" → "Project"** → elegí el repo de Costos- → **"Import"**.
3. Antes de desplegar, andá a la pestaña de integraciones/marketplace del
   proyecto y agregá **Upstash** (o "KV"/"Redis" según cómo lo liste
   Vercel) — esto crea la base gratis y carga `UPSTASH_REDIS_REST_URL` /
   `UPSTASH_REDIS_REST_TOKEN` solo, sin que tengas que copiar nada. Si ya
   creaste la base vos mismo en el paso 1, pegá esas dos variables a mano en
   **"Environment Variables"**.
4. En esa misma sección de variables de entorno, agregá también:
   - `APP_PASSWORD`: la contraseña que vas a usar para entrar a la app.
   - `SESSION_SECRET`: un texto largo y aleatorio (por ejemplo, generalo en
     tu Mac con `openssl rand -hex 32` en la Terminal, y pegá el resultado).
5. Apretá **"Deploy"**. En un par de minutos te da un link
   (`https://tu-proyecto.vercel.app`) — ahí ya está la app online, pidiendo
   la contraseña de `APP_PASSWORD` para entrar.

### 4. Actualizaciones

Cada vez que se suba un cambio nuevo a la rama conectada en GitHub, Vercel
lo despliega solo — no hace falta hacer nada manual.

### Si además conectás Tienda Nube vía OAuth

El "Redirect URL" que configurás en el Partner Portal (ver más abajo) tiene
que apuntar al dominio de Vercel, no a localhost:
`https://tu-proyecto.vercel.app/oauth/callback`.

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

Las credenciales se guardan en la base de datos (Redis), nunca en el código
ni en git. La interfaz nunca vuelve a mostrar el Access Token ni el Client
Secret una vez guardados (sólo indica si hay uno cargado); si querés
cambiarlos, simplemente pegá uno nuevo.

Como alternativa (por ejemplo para un despliegue sin interfaz), también se
pueden definir `TN_STORE_ID`, `TN_ACCESS_TOKEN`, `TN_USER_AGENT`,
`TN_CLIENT_ID` y `TN_CLIENT_SECRET` como variables de entorno — se usan como
respaldo si no hay nada guardado desde la app.

Importante: Tienda Nube no tiene un campo de "costo" ni "margen" por
producto, así que esos datos se guardan en la base de datos propia de esta
app (no se suben a tu tienda). Lo único que la app escribe de vuelta en
Tienda Nube es el **precio de venta**, y sólo cuando apretás "Aplicar en
Tienda Nube" — nunca automáticamente.

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
server/app.mjs       La app de Express: rutas de API, login, cliente de Tienda Nube
server/index.mjs     Arranque local (npm start) — importa app.mjs y hace app.listen()
server/store.mjs     Persistencia en Upstash Redis
server/auth.mjs      Login de una contraseña compartida (cookie firmada)
api/index.mjs        Punto de entrada para Vercel — mismo app.mjs, sin app.listen()
vercel.json          Manda todas las rutas a api/index.mjs
public/              Frontend (HTML/CSS/JS sin build step)
tests/               Tests del motor de cálculo (`npm test`)
```

## Seguridad

La app pide una contraseña (`APP_PASSWORD`) para entrar, porque al estar en
un link público cualquiera que lo tenga podría ver tus costos o cambiar
precios reales en tu Tienda Nube si no hubiera nada que lo impida. Es un
login simple (una sola contraseña compartida, sin usuarios individuales) —
suficiente para uso personal, no pensado para dar accesos distintos a varias
personas todavía.

## Roadmap sugerido

- [ ] Historial de precios aplicados en Tienda Nube.
- [ ] Simulación de "cuotas" (costo financiero de tarjeta a distintos plazos).
- [ ] Alertas cuando el precio actual en Tienda Nube da margen negativo.
- [ ] Usuarios individuales (hoy es una sola contraseña compartida) — paso
      natural cuando se piense en que otros negocios usen la app.
