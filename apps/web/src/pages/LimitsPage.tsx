export function LimitsPage() {
  return (
    <article className="card prose-sm max-w-3xl space-y-4">
      <h1 className="text-2xl font-extrabold text-petrol-900">Limiti e responsabilità</h1>
      <section className="space-y-2">
        <h2 className="h-section">Cosa fa l’app</h2>
        <p>
          Raccoglie e rende leggibili dati, ipotesi, limiti e alternative, affinché un tecnico, un agricoltore o un agronomo possa confrontare scenari, motivare una scelta e verificarla in seguito.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="h-section">Cosa non fa</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Non prende decisioni: ogni raccomandazione può essere accettata, modificata, rifiutata o inviata a un esperto.</li>
          <li>Non è un Digital Twin predittivo calibrato: in modalità Demo i modelli sono illustrativi e non validati.</li>
          <li>Non presenta stime come misure: Open-Meteo e servizi simili forniscono stime modellistiche riferite a coordinate, non sensori sul posto.</li>
          <li>Non formula diagnosi agronomiche, fitosanitarie o mediche e non prescrive trattamenti né irrigazioni.</li>
          <li>Non usa fotografie come diagnosi (l’AI visuale è in Roadmap e resterà disattivata senza dataset, benchmark e supervisione).</li>
          <li>Non attribuisce validità legale automatica a dossier o decisioni.</li>
          <li>Non trasferisce i risultati dei casi studio esterni nello scenario locale.</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2 className="h-section">Costi</h2>
        <p>Il costo del prototipo software è distinto dal costo dell’intervento. Un prototipo gratuito non rende gratuito l’intervento; i costi mostrati in Demo sono parametri illustrativi, non derivati da prezzari.</p>
      </section>
      <section className="space-y-2">
        <h2 className="h-section">Dati personali e privacy</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>In Milestone 0 i progetti restano nel tuo browser (IndexedDB): nessun dato viene inviato a server dell’app.</li>
          <li>Le richieste a Open-Meteo contengono solo le coordinate dell’area analizzata; le mappe caricano tile da OpenStreetMap.</li>
          <li>Puoi esportare, correggere ed eliminare i tuoi progetti dalla pagina Progetti.</li>
          <li>Geolocalizzazione, foto ed EXIF saranno gestiti con consenso esplicito (Milestone 1).</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2 className="h-section">Responsabilità</h2>
        <p>Le scelte restano in capo a chi le firma (tecnico, approvatore, agricoltore, agronomo). L’app documenta il percorso, non lo sostituisce.</p>
      </section>
    </article>
  );
}
