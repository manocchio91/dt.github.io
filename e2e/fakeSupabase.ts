import type { Page, Route } from '@playwright/test';
import { seedCampobasso, type ProjectBundle } from '../packages/domain/src/index';
import { handleMedia, initialMediaState, type MediaState } from './fakeMedia';

/**
 * Backend Supabase SIMULATO per gli E2E (Auth + PostgREST minimi).
 * Applica le stesse regole di permesso della migrazione per le chiamate usate
 * dall'app, così l'interfaccia viene provata contro risposte realistiche.
 * Non sostituisce la verifica su un progetto Supabase reale.
 */
export const SB = 'http://supabase.e2e.test';
export const ORG_A = '00000000-0000-4000-8000-0000000000a1';
export const ORG_B = '00000000-0000-4000-8000-0000000000b1';
export const USER = { id: '00000000-0000-4000-8000-00000000e2e1', email: 'tecnico@comune.test', password: 'password-di-prova-e2e' };

type Role = 'viewer' | 'editor' | 'approver' | 'admin';

export interface FakeState extends MediaState {
  memberships: { organization_id: string; user_id: string; role: Role; name: string }[];
  docs: Record<string, { bundle: ProjectBundle; version: number; org: string }>;
  prefs: Record<string, unknown>;
  prefWrites: unknown[];
  rpcCalls: { name: string; body: unknown; status: number }[];
}

export function initialState(): FakeState {
  const demo = seedCampobasso(new Date('2026-10-24T08:00:00Z'));
  return {
    memberships: [
      { organization_id: ORG_A, user_id: USER.id, role: 'viewer', name: 'Comune A' },
      { organization_id: ORG_B, user_id: USER.id, role: 'editor', name: 'Comune B' },
    ],
    docs: { [demo.project.id]: { bundle: demo, version: 1, org: ORG_A } },
    prefs: {},
    prefWrites: [],
    ...initialMediaState(),
    rpcCalls: [],
  };
}

const json = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...headers }, body: body === undefined ? '' : JSON.stringify(body) });

function session() {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: `token-${USER.id}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: 'refresh-e2e',
    user: { id: USER.id, aud: 'authenticated', role: 'authenticated', email: USER.email, app_metadata: {}, user_metadata: {}, created_at: '2026-10-24T08:00:00Z' },
  };
}

const eqParam = (url: URL, key: string) => url.searchParams.get(key)?.replace(/^eq\./, '') ?? null;

export async function installFakeSupabase(page: Page, state: FakeState) {
  await page.route(`${SB}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    }
    const authed = (req.headers()['authorization'] ?? '') === `Bearer token-${USER.id}`;
    const p = url.pathname;
    const roleIn = (org: string) => state.memberships.find((m) => m.organization_id === org && m.user_id === USER.id)?.role;
    if (await handleMedia(route, state, roleIn, authed ? USER.id : null)) return;

    if (p === '/auth/v1/token') {
      const body = req.postDataJSON() as { email?: string; password?: string };
      if (body.email === USER.email && body.password === USER.password) return json(route, 200, session());
      return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
    }
    if (p === '/auth/v1/user') return authed ? json(route, 200, session().user) : json(route, 401, { msg: 'unauthorized' });
    if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });

    if (!authed) return json(route, 200, []); // RLS: anonimo non vede nulla

    if (p === '/rest/v1/memberships') {
      const rows = state.memberships.filter((m) => m.user_id === USER.id).map((m) => ({ organization_id: m.organization_id, role: m.role, organizations: { name: m.name } }));
      return json(route, 200, rows);
    }
    if (p === '/rest/v1/project_documents') {
      const org = eqParam(url, 'organization_id');
      const pid = eqParam(url, 'project_id');
      const visible = Object.values(state.docs).filter((d) => state.memberships.some((m) => m.organization_id === d.org && m.user_id === USER.id));
      const rows = visible
        .filter((d) => (!org || d.org === org) && (!pid || d.bundle.project.id === pid))
        .map((d) => ({ project_id: d.bundle.project.id, version: d.version, bundle: d.bundle }));
      const wantsObject = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
      if (wantsObject) return rows[0] ? json(route, 200, rows[0]) : json(route, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows' });
      return json(route, 200, rows);
    }
    if (p === '/rest/v1/user_preferences') {
      if (method === 'GET') {
        const p0 = state.prefs[USER.id];
        const row = p0 ? { preferences: p0 } : null;
        const wantsObject = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
        if (wantsObject) return row ? json(route, 200, row) : json(route, 406, { code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' });
        return json(route, 200, row ? [row] : []);
      }
      const body = req.postDataJSON() as { user_id: string; preferences: Record<string, unknown> } | { user_id: string; preferences: Record<string, unknown> }[];
      const row = Array.isArray(body) ? body[0]! : body;
      state.prefWrites.push(row);
      if (row.user_id !== USER.id) return json(route, 403, { code: '42501', message: 'new row violates row-level security policy' });
      const forbidden = ['role', 'roles', 'permissions', 'canEdit', 'canAdmin', 'canApprove', 'organization_id'];
      if (forbidden.some((k) => k in row.preferences)) return json(route, 400, { code: '23514', message: 'violates check constraint' });
      state.prefs[USER.id] = row.preferences;
      return json(route, 201, undefined);
    }
    if (p === '/rest/v1/shared_links') return json(route, 200, []);
    if (p === '/rest/v1/rpc/save_project') {
      const body = req.postDataJSON() as { p_organization_id: string; p_bundle: ProjectBundle; p_expected_version: number };
      const role = state.memberships.find((m) => m.organization_id === body.p_organization_id && m.user_id === USER.id)?.role;
      const canEdit = role === 'editor' || role === 'approver' || role === 'admin';
      if (!canEdit) {
        state.rpcCalls.push({ name: 'save_project', body, status: 403 });
        return json(route, 403, { code: '42501', message: 'Permesso negato: serve il ruolo editor nell’organizzazione.' });
      }
      const id = body.p_bundle.project.id;
      const cur = state.docs[id];
      if ((cur?.version ?? 0) !== body.p_expected_version) {
        state.rpcCalls.push({ name: 'save_project', body, status: 409 });
        return json(route, 409, { code: '40001', message: 'Conflitto' });
      }
      state.docs[id] = { bundle: body.p_bundle, version: body.p_expected_version + 1, org: body.p_organization_id };
      state.rpcCalls.push({ name: 'save_project', body, status: 200 });
      return json(route, 200, body.p_expected_version + 1);
    }
    return json(route, 404, { message: `non simulato: ${method} ${p}` });
  });
}
