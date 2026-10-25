/**
 * Etichette di provenienza visivamente distinte (simbolo + bordo + colore + testo + descrizione
 * accessibile): un dato Open-Meteo non si confonde con un sensore, con una stima da modello
 * (Timestral, baseline) o con un dato simulato. Il colore non è mai l'unico segnale.
 */
export type SourceKind = 'OPEN_METEO' | 'SENSORE' | 'STIMATO_DA_MODELLO' | 'SIMULATO';

export const SOURCE_STYLE: Record<SourceKind, { label: string; symbol: string; cls: string; description: string }> = {
  OPEN_METEO: {
    label: 'DATO OPEN-METEO',
    symbol: '☁',
    cls: 'border-2 border-dotted border-meteo-700 bg-meteo-50 text-meteo-900',
    description: 'dato meteorologico modellato da Open-Meteo per una cella di alcuni chilometri, non una misura sul posto',
  },
  SENSORE: {
    label: 'MISURATO DA SENSORE',
    symbol: '●',
    cls: 'border-2 border-leaf-800 bg-leaf-800 text-white',
    description: 'valore misurato da un sensore installato nell’area',
  },
  STIMATO_DA_MODELLO: {
    label: 'STIMATO DA MODELLO',
    symbol: '≈',
    cls: 'border border-petrol-700 bg-petrol-100 text-petrol-900',
    description: 'valore calcolato da un modello a partire da altri dati, con la sua incertezza',
  },
  SIMULATO: {
    label: 'SIMULATO',
    symbol: '◇',
    cls: 'border border-dashed border-ochre-800 bg-ochre-100 text-ochre-800',
    description: 'valore dimostrativo, non riferito a dati reali',
  },
};

export function SourceBadge({ kind, detail, testId }: { kind: SourceKind; detail?: string; testId?: string }) {
  const s = SOURCE_STYLE[kind];
  return (
    <span data-source={kind} data-testid={testId} title={s.description} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.7rem] font-bold tracking-wide whitespace-nowrap ${s.cls}`}>
      <span aria-hidden="true">{s.symbol}</span>
      {s.label}
      {detail && <span className="font-semibold normal-case"> — {detail}</span>}
      <span className="sr-only">: {s.description}</span>
    </span>
  );
}
