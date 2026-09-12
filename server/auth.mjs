// Login simple de una sola contraseña compartida (APP_PASSWORD), pensado para
// una app personal de un solo usuario que ahora vive en un link público. No es
// un sistema de cuentas — es sólo para que no cualquiera que encuentre la URL
// pueda ver tus costos o tocar precios reales en tu Tienda Nube.
//
// La sesión se guarda en una cookie firmada (HMAC con SESSION_SECRET), no en
// memoria del servidor: así funciona igual en un servidor local de toda la
// vida que en funciones serverless (Vercel), donde cada request puede caer
// en una instancia distinta y no hay memoria compartida entre ellas.
import crypto from 'node:crypto';

const COOKIE_NAME = 'costos_session';
const ONE_WEEK_SECONDS = 7 * 24 * 60 * 60;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      'Falta SESSION_SECRET en las variables de entorno (necesaria para firmar la sesión de login).',
    );
  }
  return secret;
}

function sign(value) {
  const hmac = crypto.createHmac('sha256', getSecret()).update(value).digest('hex');
  return `${value}.${hmac}`;
}

/** Devuelve el valor original si la firma es válida, o null si no lo es / falta. */
function verify(signedValue) {
  if (!signedValue) return null;
  const idx = signedValue.lastIndexOf('.');
  if (idx === -1) return null;
  const value = signedValue.slice(0, idx);
  const signature = signedValue.slice(idx + 1);
  const expected = crypto.createHmac('sha256', getSecret()).update(value).digest('hex');

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  return crypto.timingSafeEqual(sigBuf, expectedBuf) ? value : null;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function issueSessionCookie(res) {
  const token = sign(String(Date.now()));
  const secureFlag = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly;${secureFlag} Path=/; Max-Age=${ONE_WEEK_SECONDS}; SameSite=Lax`,
  );
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`);
}

function hasValidSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verify(cookies[COOKIE_NAME]) !== null;
}

/** Compara la contraseña ingresada contra APP_PASSWORD, sin filtrar por timing. */
export function checkPassword(candidate) {
  const real = process.env.APP_PASSWORD;
  if (!real) {
    throw new Error('Falta APP_PASSWORD en las variables de entorno.');
  }
  const a = Buffer.from(String(candidate ?? ''));
  const b = Buffer.from(real);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Middleware que exige sesión válida. Las rutas de login (la página y su API)
 * quedan afuera para no armar un loop de redirecciones.
 */
// Únicas rutas alcanzables sin sesión: la página de login, su API, y el CSS
// que esa página necesita para verse bien (si no, redirige a /login.html en
// loop apenas el navegador intenta cargar el estilo).
const PUBLIC_PATHS = new Set(['/login.html', '/api/login', '/styles.css']);

export function requireAuth(req, res, next) {
  if (PUBLIC_PATHS.has(req.path)) {
    return next();
  }
  if (hasValidSession(req)) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'No autenticado. Iniciá sesión de nuevo.' });
  }
  res.redirect('/login.html');
}
