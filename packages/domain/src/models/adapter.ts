/** Interfacce del motore a plugin (§7). */

export type AdapterKind = 'urban' | 'agriculture' | 'cost' | 'uncertainty';
export type ModelMaturity = 'demo-illustrative' | 'calibrated';
export type ProjectMode = 'demo' | 'pilota';

export interface ModelOutputSpec {
  key: string;
  unit: string;
  description: string;
}

export interface ModelParameter {
  key: string;
  label: string;
  unit: string;
  low: number;
  central: number;
  high: number;
  source: string;
}

export interface ModelAdapterMeta {
  id: string;
  version: string;
  kind: AdapterKind;
  name: string;
  maturity: ModelMaturity;
  validityScope: string;
  requiredInputs: string[];
  outputs: ModelOutputSpec[];
  assumptions: string[];
  scientificSource: string;
  uncertaintyMethod: string;
  validationDate: string | null;
  reviewer: string | null;
  parameters: ModelParameter[];
  testFile: string;
}

export function modelRef(meta: Pick<ModelAdapterMeta, 'id' | 'version'>): string {
  return `${meta.id}@${meta.version}`;
}

export class ModelRegistry {
  private readonly adapters = new Map<string, ModelAdapterMeta>();

  register(meta: ModelAdapterMeta): void {
    if (meta.maturity === 'calibrated' && (!meta.validationDate || !meta.reviewer)) {
      throw new Error(`${modelRef(meta)}: un modello calibrato richiede data di validazione e revisore.`);
    }
    this.adapters.set(modelRef(meta), meta);
  }

  list(): ModelAdapterMeta[] {
    return [...this.adapters.values()];
  }

  /** Restituisce l'adapter se utilizzabile nella modalità richiesta. */
  resolve(ref: string, mode: ProjectMode): ModelAdapterMeta {
    const meta = this.adapters.get(ref);
    if (!meta) throw new Error(`Modello ${ref} non registrato.`);
    if (mode === 'pilota' && meta.maturity !== 'calibrated') {
      throw new Error(
        `${ref} è un modello dimostrativo illustrativo e non può essere usato in modalità Pilota calibrato.`,
      );
    }
    return meta;
  }

  availableFor(kind: AdapterKind, mode: ProjectMode): ModelAdapterMeta[] {
    return this.list().filter((m) => m.kind === kind && (mode === 'demo' || m.maturity === 'calibrated'));
  }
}
