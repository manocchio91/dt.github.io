import { DEMO_AGRI_META } from '../agri/agriDemo';
import { ModelRegistry } from './adapter';
import { DEMO_COST_META } from './costDemo';
import { DEMO_UNCERTAINTY_META } from './uncertainty';
import { DEMO_URBAN_META } from './urbanDemo';

export function createDefaultRegistry(): ModelRegistry {
  const r = new ModelRegistry();
  r.register(DEMO_URBAN_META);
  r.register(DEMO_AGRI_META);
  r.register(DEMO_COST_META);
  r.register(DEMO_UNCERTAINTY_META);
  return r;
}
