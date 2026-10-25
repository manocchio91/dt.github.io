import type { Sector } from '../project/bundle';

/**
 * Onboarding per profilo (B-102).
 *
 * Il PROFILO OPERATIVO descrive il lavoro dell'utente e adatta testi e percorso.
 * Il RUOLO DI AUTORIZZAZIONE (lettura/modifica/approvazione/amministrazione) è
 * assegnato dall'amministratore dell'organizzazione e vive altrove (memberships).
 * Questo modulo non conosce né produce ruoli: per costruzione, scegliere un
 * profilo non può aumentare i permessi.
 */

export const OPERATIONAL_PROFILES = ['tecnico_comunale', 'gestore_verde', 'agricoltore', 'agronomo', 'revisore'] as const;
export type OperationalProfile = (typeof OPERATIONAL_PROFILES)[number];

export const PROFILE_LABEL: Record<OperationalProfile, { title: string; hint: string }> = {
  tecnico_comunale: { title: 'Tecnico comunale', hint: 'Valuto interventi su piazze, strade e spazi pubblici.' },
  gestore_verde: { title: 'Gestore del verde o progettista', hint: 'Progetto e curo alberi, aiuole e superfici verdi.' },
  agricoltore: { title: 'Agricoltore o viticoltore', hint: 'Voglio sapere quale zona dei miei campi controllare.' },
  agronomo: { title: 'Agronomo o consulente', hint: 'Verifico dati e fasi della coltura prima di consigliare.' },
  revisore: { title: 'Revisore o approvatore', hint: 'Leggo le proposte e controllo le motivazioni.' },
};

/** Ambito suggerito per profilo (modificabile). Il revisore lavora su entrambi. */
export const PROFILE_DEFAULT_SECTOR: Record<OperationalProfile, Sector | null> = {
  tecnico_comunale: 'urban',
  gestore_verde: 'urban',
  agricoltore: 'agriculture',
  agronomo: 'agriculture',
  revisore: null,
};

export const SECTOR_LABEL: Record<Sector, { title: string; hint: string }> = {
  urban: { title: 'Città', hint: 'Calore in piazze, strade, parchi e percorsi.' },
  agriculture: { title: 'Campagna', hint: 'Stress della coltura, a partire dal vigneto.' },
};

interface Option {
  id: string;
  title: string;
  hint: string;
}

/**
 * Decisioni: elenchi separati per ambito, nessuna voce in comune.
 * Le voci descrivono ciò che l'utente vuole capire: l'app non prescrive irrigazioni,
 * trattamenti o interventi automatici.
 */
export const DECISIONS: Record<Sector, Option[]> = {
  urban: [
    { id: 'individuare_area_calda', title: 'Individuare le zone più esposte al caldo', hint: 'Capire dove il calore pesa di più sulle persone.' },
    { id: 'ridurre_calore', title: 'Controllare una piazza, una strada o un parco', hint: 'Un luogo preciso che d’estate diventa troppo caldo.' },
    { id: 'scegliere_intervento', title: 'Confrontare possibili interventi', hint: 'Alberi, ombra, nuove superfici: costi, acqua e benefici a confronto.' },
    { id: 'monitorare_soglia', title: 'Tenere d’occhio una soglia di caldo', hint: 'Sapere in anticipo se e quando potrebbe essere superata.' },
    { id: 'verificare_risultato', title: 'Verificare gli effetti di un intervento già fatto', hint: 'Confrontare quanto previsto con quanto osservato dopo.' },
  ],
  agriculture: [
    { id: 'valutare_irrigazione', title: 'Controllare lo stress da caldo o da siccità', hint: 'Capire se la coltura soffre. Ogni scelta su acqua o trattamenti resta tua e dell’agronomo.' },
    { id: 'documentare_campo', title: 'Osservare una parcella', hint: 'Annotare ciò che vedi in campo, legato a zona e data.' },
    { id: 'fase_fenologica', title: 'Tenere conto della fase della coltura', hint: 'Germogliamento, fioritura, invaiatura: il rischio cambia con la fase.' },
    { id: 'soglia_agronomo', title: 'Verificare una soglia indicata dall’agronomo', hint: 'Sapere se e quando potrebbe essere superata.' },
    { id: 'zona_da_controllare', title: 'Programmare un sopralluogo', hint: 'Capire quale zona controllare per prima.' },
    { id: 'confrontare_scenari', title: 'Confrontare condizioni e scenari', hint: 'Mettere a confronto zone, periodi e ipotesi diverse.' },
  ],
};

/** Decisioni delle versioni precedenti, ricondotte alla voce attuale più vicina. */
const LEGACY_DECISIONS: Record<string, string> = {
  motivare_proposta: 'scegliere_intervento',
  verificare_risposta: 'confrontare_scenari',
};

/** Dati posseduti: elenchi separati per ambito (niente indicatori misti). */
export const DATA_SOURCES: Record<Sector, Option[]> = {
  urban: [
    { id: 'confini_area', title: 'Confini dell’area (mappa o file)', hint: 'Un disegno o un file GeoJSON.' },
    { id: 'temperature_superfici', title: 'Temperature delle superfici', hint: 'Da termocamera o immagini da satellite.' },
    { id: 'sensori_aria', title: 'Sensori di temperatura dell’aria', hint: 'Centraline o sensori nella zona.' },
    { id: 'costi_interventi', title: 'Costi degli interventi', hint: 'Prezzari o preventivi.' },
  ],
  agriculture: [
    { id: 'confini_parcelle', title: 'Confini delle parcelle (mappa o file)', hint: 'Un disegno o un file GeoJSON.' },
    { id: 'sonda_suolo', title: 'Sonda di umidità del suolo', hint: 'Una misura diretta nel terreno.' },
    { id: 'stazione_meteo', title: 'Stazione meteo in azienda', hint: 'Temperature e piogge misurate sul posto.' },
    { id: 'osservazioni_campo', title: 'Osservazioni in campo e trappole', hint: 'Appunti, foto, conteggi.' },
    { id: 'analisi_suolo', title: 'Analisi del suolo', hint: 'Tessitura, profondità, capacità di trattenere acqua.' },
  ],
};

export type AreaChoice = { kind: 'demo' } | { kind: 'nuovo'; name: string } | { kind: 'esistente'; projectId: string };
export type WorkMode = 'guidata' | 'tecnica';

export const MODE_LABEL: Record<WorkMode, { title: string; hint: string }> = {
  guidata: { title: 'Guidata', hint: 'Un passo alla volta, con suggerimenti. I dettagli tecnici si aprono su richiesta.' },
  tecnica: { title: 'Tecnica', hint: 'Tutti i dettagli già aperti: provenienza, modelli, versioni e dati per la verifica.' },
};

export interface OnboardingPreferences {
  version: 1;
  profile: OperationalProfile;
  sector: Sector;
  decision: string;
  area: AreaChoice;
  data: string[];
  mode: WorkMode;
  completedAt: string;
}

export type OnboardingDraft = Partial<Omit<OnboardingPreferences, 'version' | 'completedAt'>>;

export const ONBOARDING_STEPS = ['profilo', 'ambito', 'decisione', 'area', 'dati', 'modalita'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const ALLOWED_KEYS = new Set(['version', 'profile', 'sector', 'decision', 'area', 'data', 'mode', 'completedAt']);

/** Errori per passo; un passo senza errori è completo. */
export function validateStep(step: OnboardingStep, d: OnboardingDraft): string[] {
  switch (step) {
    case 'profilo':
      return d.profile && OPERATIONAL_PROFILES.includes(d.profile) ? [] : ['Scegli il profilo che ti descrive meglio.'];
    case 'ambito':
      return d.sector === 'urban' || d.sector === 'agriculture' ? [] : ['Scegli se lavori in città o in campagna.'];
    case 'decisione':
      if (!d.sector) return ['Scegli prima l’ambito.'];
      return DECISIONS[d.sector].some((o) => o.id === d.decision) ? [] : ['Scegli la decisione da affrontare.'];
    case 'area':
      if (!d.area) return ['Scegli l’area o il progetto.'];
      if (d.area.kind === 'nuovo' && d.area.name.trim().length < 3) return ['Dai un nome al nuovo progetto (almeno 3 caratteri).'];
      if (d.area.kind === 'esistente' && !d.area.projectId) return ['Scegli un progetto esistente.'];
      return [];
    case 'dati': {
      if (!d.sector) return ['Scegli prima l’ambito.'];
      const allowed = new Set(DATA_SOURCES[d.sector].map((o) => o.id));
      return (d.data ?? []).every((x) => allowed.has(x)) ? [] : ['Alcuni dati selezionati non appartengono all’ambito scelto.'];
    }
    case 'modalita':
      return d.mode === 'guidata' || d.mode === 'tecnica' ? [] : ['Scegli la modalità di lavoro.'];
  }
}

/** Cambiando ambito si rimuovono le scelte dell'altro ambito (nessuna commistione). */
export function changeSector(d: OnboardingDraft, sector: Sector): OnboardingDraft {
  if (d.sector === sector) return d;
  return {
    ...d,
    sector,
    decision: undefined,
    data: [],
    area: d.area?.kind === 'esistente' ? undefined : d.area,
  };
}

export function finalizeOnboarding(d: OnboardingDraft, now: Date): OnboardingPreferences {
  const errors = ONBOARDING_STEPS.flatMap((s) => validateStep(s, d));
  if (errors.length) throw new Error(errors.join(' '));
  return {
    version: 1,
    profile: d.profile!,
    sector: d.sector!,
    decision: d.decision!,
    area: d.area!,
    data: [...new Set(d.data ?? [])],
    mode: d.mode!,
    completedAt: now.toISOString(),
  };
}

/**
 * Lettura difensiva di preferenze salvate (localStorage o database): scarta
 * qualunque campo sconosciuto (es. un "role" iniettato) e valori incoerenti.
 */
export function parsePreferences(raw: unknown): OnboardingPreferences | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (ALLOWED_KEYS.has(k)) clean[k] = v;
  if (clean.version !== 1 || typeof clean.completedAt !== 'string') return null;
  const area = clean.area as AreaChoice | undefined;
  const draft: OnboardingDraft = {
    profile: clean.profile as OperationalProfile,
    sector: clean.sector as Sector,
    decision: typeof clean.decision === 'string' ? (LEGACY_DECISIONS[clean.decision] ?? clean.decision) : undefined,
    area: area && typeof area === 'object' ? area : undefined,
    data: Array.isArray(clean.data) ? (clean.data as string[]) : [],
    mode: clean.mode as WorkMode,
  };
  if (ONBOARDING_STEPS.some((s) => validateStep(s, draft).length)) return null;
  return { ...finalizeOnboarding(draft, new Date(clean.completedAt as string)) };
}

export type OnboardingTarget =
  | { kind: 'demo'; sector: Sector }
  | { kind: 'nuovo'; sector: Sector; name: string }
  | { kind: 'progetto'; projectId: string; path: string };

/** Instradamento verso il flusso corretto, sempre coerente con l'ambito scelto. */
export function onboardingTarget(p: OnboardingPreferences, projects: readonly { id: string; sector: Sector; hasArea: boolean }[]): OnboardingTarget {
  if (p.area.kind === 'demo') return { kind: 'demo', sector: p.sector };
  if (p.area.kind === 'nuovo') return { kind: 'nuovo', sector: p.sector, name: p.area.name.trim() };
  const projectId = p.area.projectId;
  const proj = projects.find((x) => x.id === projectId && x.sector === p.sector);
  if (!proj) return { kind: 'demo', sector: p.sector };
  return {
    kind: 'progetto',
    projectId: proj.id,
    path: proj.hasArea ? labPath(proj.id, p.sector) : `/progetti/${proj.id}/area`,
  };
}

export function labPath(projectId: string, sector: Sector): string {
  return `/progetti/${projectId}/${sector === 'urban' ? 'urbano' : 'agricolo'}`;
}

/** Cosa comporta ciò che l'utente NON possiede, in linguaggio semplice. */
export function dataConsequences(p: Pick<OnboardingPreferences, 'sector' | 'data'>): string[] {
  const has = new Set(p.data);
  const out: string[] = [];
  if (p.sector === 'urban') {
    if (!has.has('temperature_superfici')) out.push('Senza temperature delle superfici useremo valori stimati: li vedrai segnati come stime.');
    if (!has.has('sensori_aria')) out.push('Senza sensori, la temperatura dell’aria arriva da un modello meteo, non da una misura sul posto.');
    if (!has.has('costi_interventi')) out.push('I costi saranno indicativi, non presi da un prezzario.');
  } else {
    if (!has.has('sonda_suolo')) out.push('Senza sonda, l’umidità del suolo è una stima per l’area: la fiducia sarà più bassa.');
    if (!has.has('stazione_meteo')) out.push('Le temperature arrivano da un modello meteo, non da una stazione nel vigneto.');
    if (!has.has('analisi_suolo')) out.push('Senza analisi del suolo, lo stress idrico resta da confermare in campo.');
  }
  return out;
}
