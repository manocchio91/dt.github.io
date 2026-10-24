-- Seed di riferimento (eseguito come postgres / service role, separato dai dati reali).
-- I progetti DEMO (Campobasso, vigneto molisano) NON sono inseriti qui: si caricano dall'app
-- con "Carica demo" dopo l'accesso, così il documento di progetto è completo e marcato DEMO.

insert into model_versions (adapter_id, version, kind, maturity, validity_scope, required_inputs, outputs, assumptions, scientific_source, uncertainty_method) values
  ('demo-urban-illustrative', '0.1.0', 'urban', 'demo_illustrative', 'Spazi aperti urbani di piccola scala, estate, ora diurna', '[]', '[]', '[]', 'Parametri illustrativi DEMO non validati', 'Inviluppo parametri'),
  ('demo-vineyard-components', '0.1.0', 'agriculture', 'demo_illustrative', 'Vigneto, stagione vegetativa', '[]', '[]', '[]', 'Bilancio idrico semplificato, soglie DEMO', 'Fiducia qualitativa'),
  ('demo-cost-parametric', '0.1.0', 'cost', 'demo_illustrative', 'Ordine di grandezza', '[]', '[]', '[]', 'Costi parametrici DEMO', 'Inviluppo costi unitari')
on conflict (adapter_id, version) do nothing;
