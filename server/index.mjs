// Punto de entrada para correr la app en tu máquina (`npm start`). En Vercel
// no se usa este archivo: se usa api/index.mjs, que importa la misma app de
// ./app.mjs pero deja que Vercel maneje el servidor HTTP.
import app from './app.mjs';
import * as tiendanube from './tiendanube.mjs';

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Costos- corriendo en http://localhost:${PORT}`);
  console.log(
    (await tiendanube.isConfigured())
      ? 'Tienda Nube: conectada.'
      : 'Tienda Nube: no configurada. Conectala desde la sección "Conectar tienda" en la app.',
  );
});
