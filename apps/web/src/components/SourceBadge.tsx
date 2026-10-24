/**
 * Etichette di provenienza visivamente distinte (simbolo + bordo + colore + testo):
 * un dato Open-Meteo non si confonde con un sensore, con una stima da modello (Timestral,
 * baseline) o con un dato simulato.
 */
export type SourceKind = 'OPEN_METEO' | 'SENSORE' | 'STIMATO_DA_MODELLO' | 'SIMULATO';

const STYLE: Record<SourceKind, { label: string; symbol: string; cls: string }> = {
  OPEN_METEO: { label: 'DATO OPEN-METEO', symbol: '☁', cls: 'border-2 border-dotted border-meteo-700 bg-meteo-50 text-meteo-900' },
  SENSORE: { label: 'DATO DA SENSORE', symbol: '●', cls: 'border-2 border-leaf-800 bg-leaf-800 text-white' },
  STIMATO_DA_MODELLO: { label: 'STIMATO DA MODELLO', symbol: '≈', cls: 'border border-petrol-700 bg-petrol-100 text-petrol-900' },
  SIMULATO: { label: 'SIMULATO', symbol: '◇', cls: 'border border-dashed border-ochre-800 bg-ochre-100 text-ochre-800' },
};

export function SourceBadge({ kind, detail }: { kind: SourceKind; detail?: string }) {
  const s = STYLE[kind];
  return (
    <span data-source={kind} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.7rem] font-bold tracking-wide whitespace-nowrap ${s.cls}`}>
      <span aria-hidden="true">{s.symbol}</span>
      {s.label}
      {detail && <span className="font-semibold normal-case">— {detail}</span>}
    </span>
  );
}
