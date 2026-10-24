import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

export type OrgRole = 'viewer' | 'editor' | 'approver' | 'admin';

export interface Membership {
  organizationId: string;
  organizationName: string;
  role: OrgRole;
}

interface AuthValue {
  /** null = Supabase non configurato (modalità solo locale) */
  client: SupabaseClient | null;
  ready: boolean;
  session: Session | null;
  memberships: Membership[];
  current: Membership | null;
  selectOrganization(id: string | null): void;
  refreshMemberships(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, displayName: string): Promise<'session' | 'confirm_email'>;
  sendMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;
  createOrganization(name: string): Promise<string>;
  addMember(email: string, role: OrgRole): Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);
const ORG_KEY = 'mdt:organization';

const readOrg = () => {
  try {
    return localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
};

export function AuthProvider({ children, client = getSupabase() }: { children: ReactNode; client?: SupabaseClient | null }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!client);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [orgId, setOrgId] = useState<string | null>(readOrg);

  useEffect(() => {
    if (!client) return;
    client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setReady(true);
    });
    const { data } = client.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [client]);

  const refreshMemberships = useCallback(async () => {
    if (!client || !session) {
      setMemberships([]);
      return;
    }
    const { data, error } = await client
      .from('memberships')
      .select('organization_id, role, organizations(name)')
      .eq('user_id', session.user.id);
    if (error) throw new Error(error.message);
    setMemberships(
      ((data ?? []) as unknown as { organization_id: string; role: OrgRole; organizations: { name: string } | null }[]).map((m) => ({
        organizationId: m.organization_id,
        organizationName: m.organizations?.name ?? '—',
        role: m.role,
      })),
    );
  }, [client, session]);

  useEffect(() => {
    if (!client) return;
    if (!session) {
      queueMicrotask(() => setMemberships([]));
      return;
    }
    refreshMemberships()
      .catch(() => setMemberships([]))
      .finally(() => setReady(true));
  }, [client, session, refreshMemberships]);

  const selectOrganization = useCallback((id: string | null) => {
    setOrgId(id);
    try {
      if (id) localStorage.setItem(ORG_KEY, id);
      else localStorage.removeItem(ORG_KEY);
    } catch {
      /* storage non disponibile */
    }
  }, []);

  const current = memberships.find((m) => m.organizationId === orgId) ?? null;

  const need = useCallback(() => {
    if (!client) throw new Error('Supabase non configurato.');
    return client;
  }, [client]);

  const value = useMemo<AuthValue>(
    () => ({
      client,
      ready,
      session,
      memberships,
      current,
      selectOrganization,
      refreshMemberships,
      async signIn(email, password) {
        const { error } = await need().auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email o password non corretti.' : error.message);
      },
      async signUp(email, password, displayName) {
        const { data, error } = await need().auth.signUp({ email, password, options: { data: { display_name: displayName } } });
        if (error) throw new Error(error.message);
        return data.session ? 'session' : 'confirm_email';
      },
      async sendMagicLink(email) {
        const { error } = await need().auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + '/accesso' } });
        if (error) throw new Error(error.message);
      },
      async signOut() {
        await need().auth.signOut();
        selectOrganization(null);
      },
      async createOrganization(name) {
        const { data, error } = await need().rpc('create_organization', { p_name: name });
        if (error) throw new Error(error.message);
        await refreshMemberships();
        selectOrganization(data as string);
        return data as string;
      },
      async addMember(email, role) {
        if (!current) throw new Error('Seleziona un’organizzazione.');
        const { error } = await need().rpc('add_member_by_email', { p_org: current.organizationId, p_email: email, p_role: role });
        if (error) throw new Error(error.message);
      },
    }),
    [client, ready, session, memberships, current, selectOrganization, refreshMemberships, need],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fuori da AuthProvider');
  return v;
}

export const ROLE_LABEL: Record<OrgRole, string> = {
  viewer: 'lettura',
  editor: 'modifica',
  approver: 'approvazione',
  admin: 'amministrazione',
};
