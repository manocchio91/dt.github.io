import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { ProjectBundle } from '@mdt/domain';
import { AuthContext, type AuthValue, type Membership } from '../state/auth';
import { PreferencesProvider } from '../state/preferences';
import { StoreProvider } from '../state/store';
import { MemoryRepository, type Repository } from '../state/repository';

export const ORG_A = '00000000-0000-4000-8000-00000000000a';
export const ORG_B = '00000000-0000-4000-8000-00000000000b';

export function fakeAuth(over: Partial<AuthValue> = {}): AuthValue {
  return {
    client: null,
    ready: true,
    session: null,
    memberships: [],
    current: null,
    selectOrganization: () => {},
    refreshMemberships: async () => {},
    signIn: async () => {},
    signUp: async () => 'session',
    sendMagicLink: async () => {},
    signOut: async () => {},
    createOrganization: async () => ORG_A,
    addMember: async () => {},
    ...over,
  };
}

export function member(role: Membership['role'], organizationId = ORG_A, organizationName = 'Comune A'): Membership {
  return { organizationId, organizationName, role };
}

export const fakeSession = (id = '00000000-0000-4000-8000-0000000000u1') => ({ user: { id, email: 'utente@comune.it' } }) as unknown as Session;

/** Repository in memoria che si presenta come archivio dell'organizzazione. */
export function remoteRepo(bundles: ProjectBundle[]): Repository {
  const base = new MemoryRepository();
  for (const b of bundles) void base.save(b);
  return {
    kind: 'supabase',
    list: () => base.list(),
    get: (id) => base.get(id),
    save: (b) => base.save(b),
    remove: (id) => base.remove(id),
  };
}

export function localRepo(bundles: ProjectBundle[]): Repository {
  const base = new MemoryRepository();
  for (const b of bundles) void base.save(b);
  return base;
}

export function LocationProbe() {
  const loc = useLocation();
  return <p data-testid="location">{loc.pathname}</p>;
}

export function renderApp(
  ui: ReactNode,
  { auth = fakeAuth(), repo = localRepo([]), route = '/', path = '*', readOnly }: { auth?: AuthValue; repo?: Repository; route?: string; path?: string; readOnly?: boolean } = {},
) {
  const ro = readOnly ?? (repo.kind === 'supabase' && auth.current?.role === 'viewer');
  return render(
    <AuthContext.Provider value={auth}>
      <PreferencesProvider>
        <StoreProvider repository={repo} readOnly={ro}>
          <MemoryRouter initialEntries={[route]}>
            <Routes>
              <Route path={path} element={ui} />
              <Route path="*" element={<LocationProbe />} />
            </Routes>
          </MemoryRouter>
        </StoreProvider>
      </PreferencesProvider>
    </AuthContext.Provider>,
  );
}

/** Doppio minimo di supabase-js per preferenze e documenti di progetto. */
export function fakeSupabase(state: { docs: Record<string, ProjectBundle[]>; prefs: Record<string, unknown> }) {
  const calls: { table: string; op: string; payload?: unknown; filters: [string, unknown][] }[] = [];
  const from = (table: string) => {
    const q = {
      op: 'select',
      filters: [] as [string, unknown][],
      payload: undefined as unknown,
      single: false,
      select() {
        return q;
      },
      eq(c: string, v: unknown) {
        q.filters.push([c, v]);
        return q;
      },
      maybeSingle() {
        q.single = true;
        return q;
      },
      upsert(payload: unknown) {
        q.op = 'upsert';
        q.payload = payload;
        return q;
      },
      then(ok: (r: { data: unknown; error: null }) => unknown) {
        calls.push({ table, op: q.op, payload: q.payload, filters: q.filters });
        let data: unknown = null;
        if (table === 'project_documents') {
          const org = q.filters.find(([c]) => c === 'organization_id')?.[1] as string;
          data = (state.docs[org] ?? []).map((b, i) => ({ project_id: b.project.id, version: i + 1, bundle: b }));
        } else if (table === 'user_preferences') {
          if (q.op === 'upsert') {
            const p = q.payload as { user_id: string; preferences: unknown };
            state.prefs[p.user_id] = p.preferences;
          } else {
            const uid = q.filters.find(([c]) => c === 'user_id')?.[1] as string;
            data = state.prefs[uid] ? { preferences: state.prefs[uid] } : null;
          }
        }
        return Promise.resolve({ data, error: null }).then(ok);
      },
    };
    return q;
  };
  return { client: { from, rpc: async () => ({ data: 1, error: null }), storage: {} } as unknown as SupabaseClient, calls };
}
