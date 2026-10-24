/**
 * Permessi nell'interfaccia, derivati SOLO dal ruolo di autorizzazione
 * nell'organizzazione. Il profilo operativo non è un parametro: non può
 * influire. Le policy RLS restano la protezione principale lato database.
 */
export const ORG_ROLES = ['viewer', 'editor', 'approver', 'admin'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_ROLE_LABEL: Record<OrgRole, string> = {
  viewer: 'lettura',
  editor: 'modifica',
  approver: 'approvazione',
  admin: 'amministrazione',
};

export interface Permissions {
  /** archivio locale del browser: l'utente è proprietario dei propri dati */
  storage: 'locale' | 'organizzazione';
  role: OrgRole | null;
  canEdit: boolean;
  canApprove: boolean;
  canAdmin: boolean;
  readOnly: boolean;
}

export function permissionsFor(storage: 'locale' | 'organizzazione', role: OrgRole | null): Permissions {
  if (storage === 'locale') {
    return { storage, role: null, canEdit: true, canApprove: false, canAdmin: true, readOnly: false };
  }
  const rank = role ? ORG_ROLES.indexOf(role) : -1;
  return {
    storage,
    role,
    canEdit: rank >= 1,
    canApprove: rank >= 2,
    canAdmin: rank >= 3,
    readOnly: rank < 1,
  };
}
