import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useStore } from '../state/store';
import { StatusBadge } from '../components/ui';
import { usePreferences } from '../state/preferences';
import { DECISIONS, PROFILE_LABEL } from '@mdt/domain';

const STEPS = [
  ['Dati', 'meteo, suolo, osservazioni, con fonte e qualità'],
  ['Baseline', 'situazione di riferimento, bloccata e versionata'],
  ['Modello dichiarato', 'formula, versione, ipotesi e limiti visibili'],
  ['Scenari', 'alternative con gli stessi presupposti'],
  ['Confronto', 'benefici, costi, acqua, incertezza'],
  ['Decisione umana', 'scelta motivata, mai automatica'],
  ['Verifica ex-post', 'previsto contro osservato'],
];

const GUIDED_STEPS = [
  ['Scegli l’area', 'definisci lo spazio urbano o la parcella'],
  ['Analizza la criticità', 'leggi dati, qualità e zone da controllare'],
  ['Prova le alternative', 'simula o valuta soltanto le opzioni supportate'],
  ['Confronta e decidi', 'registra una scelta motivata e verificabile'],
];

export function LandingPage() {
  const { openDemo, ready } = useStore();
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { preferences } = usePreferences();
  const guided = (preferences?.mode ?? 'guidata') === 'guidata';

  const go = async (kind: 'urban' | 'agriculture') => {
    setBusy(kind);
    try {
      const id = await openDemo(kind);
      nav(`/progetti/${id}/${kind === 'urban' ? 'urbano' : 'agricolo'}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-petrol-900 p-6 text-white md:p-10">
        <p className="text-sm font-semibold tracking-wide text-ochre-500 uppercase">Decision Support System dimostrativo</p>
        <h1 className="mt-2 max-w-3xl text-3xl font-extrabold md:text-5xl">Dai dati alla scelta climatica motivata</h1>
        <p className="mt-4 max-w-2xl text-base text-petrol-100 md:text-lg">
          Confronta alternative per ridurre il calore in uno spazio urbano o per capire quale zona del vigneto controllare. L’app rende leggibili dati, ipotesi, limiti e alternative: la decisione resta tua.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {preferences ? (
            <>
              <Link to="/benvenuto?modifica=1" className="btn bg-ochre-500 text-sand-900 hover:bg-ochre-100">
                Le mie preferenze
              </Link>
              <span className="text-sm text-petrol-100">
                {PROFILE_LABEL[preferences.profile].title} · {DECISIONS[preferences.sector].find((d) => d.id === preferences.decision)?.title}
              </span>
            </>
          ) : (
            <>
              <Link to="/benvenuto" className="btn bg-ochre-500 text-sand-900 hover:bg-ochre-100">
                Inizia: 6 domande, meno di 2 minuti
              </Link>
              <span className="text-sm text-petrol-100">Oppure apri subito una demo qui sotto, senza registrazione.</span>
            </>
          )}
        </div>
      </section>

      {err && (
        <p role="alert" className="rounded-md bg-alert-100 p-3 text-sm text-alert-800">
          {err}
        </p>
      )}
      <section aria-labelledby="scelta" className="grid gap-4 md:grid-cols-2">
        <h2 id="scelta" className="sr-only">
          Scegli il percorso
        </h2>
        <article className="card flex flex-col">
          <p className="text-sm font-bold text-petrol-500">Percorso urbano</p>
          <h3 className="mt-1 text-xl font-bold text-petrol-900">Tecnici comunali e gestori del verde</h3>
          <p className="mt-2 flex-1 text-sm">
            Definisci un’area, leggi la baseline, costruisci gli scenari A e B (alberi, ombra, depaving, albedo…) e confronta riduzione termica stimata, costi, acqua e manutenzione.
          </p>
          <p className="mt-2 text-xs text-sand-600">Demo: Campobasso, Piazza Vittorio Emanuele II (dati SIMULATI)</p>
          <button type="button" className="btn-secondary mt-4" disabled={!ready || busy !== null} onClick={() => go('urban')}>
            {busy === 'urban' ? 'Apertura…' : 'Apri la demo urbana'}
          </button>
        </article>
        <article className="card flex flex-col">
          <p className="text-sm font-bold text-leaf-600">Percorso agricolo</p>
          <h3 className="mt-1 text-xl font-bold text-petrol-900">Viticoltori e agronomi</h3>
          <p className="mt-2 flex-1 text-sm">
            Verifica parcelle e fase fenologica, guarda separatamente stress termico, idrico e segnali in campo, scopri quale zona controllare per prima e perché.
          </p>
          <p className="mt-2 text-xs text-sand-600">Demo: vigneto molisano, cultivar Tintilia (dati SIMULATI)</p>
          <button type="button" className="btn-secondary mt-4" disabled={!ready || busy !== null} onClick={() => go('agriculture')}>
            {busy === 'agriculture' ? 'Apertura…' : 'Apri la demo agricola'}
          </button>
        </article>
      </section>

      <section className="card">
        <h2 className="h-section">{guided ? 'Il percorso in quattro passi' : 'Pipeline completa'}</h2>
        <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(guided ? GUIDED_STEPS : STEPS).map(([t, d], i) => (
            <li key={t} className="flex gap-3 rounded-lg bg-sand-100 p-3">
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-petrol-700 text-sm font-bold text-white">{i + 1}</span>
              <span>
                <span className="block font-bold">{t}</span>
                <span className="text-sm text-sand-600">{d}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <details className="card border-l-4 border-l-ochre-500" open={!guided}>
        <summary id="maturita" className="cursor-pointer font-bold text-petrol-900">Informazioni tecniche, maturità e limiti</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>
            <strong>Modalità Demo</strong> attiva: dati aperti o dimostrativi e modelli <em>illustrativi</em>. Ogni risultato è marcato SIMULATO e mostra un <em>intervallo illustrativo</em>.
          </li>
          <li>
            <strong>Modalità Pilota calibrato</strong>: <StatusBadge status="non_disponibile" /> — richiede area reale, dati locali controllati, modello documentato e validazione professionale.
          </li>
          <li>Senza accesso i progetti restano in questo browser. L’archivio condiviso di un’organizzazione si attiva con l’accesso (non ancora collegato in questo sito pubblico).</li>
          <li>
            Casi studio (Bilbao, Siviglia, Parigi, Padova, Bologna, Campobasso…): <StatusBadge status="roadmap" /> — non verranno mai usati come output locale.
          </li>
        </ul>
        <p className="mt-3 text-sm">
          <Link to="/limiti" className="font-semibold text-petrol-700 underline">
            Limiti e responsabilità
          </Link>
        </p>
      </details>
    </div>
  );
}
