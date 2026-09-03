import { requireCsrf } from '../_lib/csrf.mjs';
import { errorResponse, securityHeaders } from '../_lib/http.mjs';

function methodNotAllowed() {
  const response = errorResponse(405);
  const headers = new Headers(response.headers);
  headers.set('Allow', 'POST');
  return new Response(response.body, { status: response.status, headers });
}

export async function onRequestPost(context) {
  const { accessClaims, account } = context?.data || {};
  if (!accessClaims || !account) return errorResponse(401);
  try {
    await requireCsrf(context.request, context.env, accessClaims);
  } catch {
    return errorResponse(403);
  }
  try {
    const headers = securityHeaders({ Location: '/cdn-cgi/access/logout', 'Cache-Control': 'no-store' });
    headers.delete('Access-Control-Allow-Origin');
    headers.delete('Access-Control-Allow-Credentials');
    return new Response(null, { status: 303, headers });
  } catch {
    return errorResponse(500);
  }
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return methodNotAllowed();
}
