import { issueCsrfToken } from './_lib/csrf.mjs';
import { errorResponse, jsonResponse } from './_lib/http.mjs';

function dataOf(context) { return context?.data || {}; }
function methodNotAllowed() {
  const response = errorResponse(405);
  const headers = new Headers(response.headers);
  headers.set('Allow', 'GET');
  return new Response(response.body, { status: response.status, headers });
}

export async function onRequestGet(context) {
  try {
    const { accessClaims, account } = dataOf(context);
    if (!accessClaims || !account) return jsonResponse({ authenticated: false });
    return jsonResponse({
      authenticated: true,
      account: { id: account.id, email: account.email ?? null },
      csrfToken: await issueCsrfToken(context.env, accessClaims.sub),
    });
  } catch {
    return errorResponse(500);
  }
}

export async function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  return methodNotAllowed();
}
