// Punto de entrada para Vercel: una función serverless que envuelve toda la
// app de Express (definida en server/app.mjs). Vercel llama a este handler
// con (req, res) en cada request; la instancia de Express ya es callable así
// (es lo que app.listen() hace por dentro), no hace falta ningún adaptador.
//
// vercel.json redirige TODAS las rutas para acá (incluyendo estáticos como
// /app.js o /styles.css), así que la misma app que sirve la API también
// sirve el frontend, igual que en local.
import app from '../server/app.mjs';

export default app;
