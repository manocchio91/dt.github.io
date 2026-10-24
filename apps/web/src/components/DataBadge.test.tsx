import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { dataValue, missingValue } from '@mdt/domain';
import { DataBadge } from './DataBadge';

beforeAll(() => {
  // jsdom non implementa <dialog>.showModal
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

const estimate = dataValue({
  key: 't_air_ref_hour',
  label: 'Temperatura aria a 2 m',
  unit: '°C',
  value: 29.5,
  dataClass: 'STIMATO_DA_MODELLO',
  lineage: {
    source: 'Open-Meteo Historical Weather API',
    endpoint: 'https://archive-api.open-meteo.com/v1/archive',
    acquiredAt: '2026-10-24T08:00:00Z',
    license: 'CC BY 4.0',
    coordinates: { lat: 41.55, lon: 14.65 },
    transforms: ['media ore 15:00'],
    quality: 'media',
    limitations: ['Stima modellistica: non è un sensore sul posto.'],
    isDemo: false,
  },
});

describe('DataBadge', () => {
  it('mostra valore, unità e classe testuale (non solo colore)', () => {
    render(<DataBadge value={estimate} />);
    expect(screen.getAllByText(/29,5 °C/)[0]).toBeVisible();
    expect(screen.getByRole('button', { name: /STIMATO DA MODELLO/ })).toHaveTextContent('STIMATO DA MODELLO');
  });

  it('il badge apre il pannello di lineage con fonte, coordinate e limiti', () => {
    render(<DataBadge value={estimate} />);
    fireEvent.click(screen.getByRole('button', { name: /apri provenienza/i }));
    expect(screen.getByText('Open-Meteo Historical Weather API')).toBeInTheDocument();
    expect(screen.getByText(/41.5500, 14.6500/)).toBeInTheDocument();
    expect(screen.getByText(/non è un sensore sul posto/)).toBeInTheDocument();
    expect(screen.getByText('CC BY 4.0')).toBeInTheDocument();
  });

  it('un dato mancante non mostra numeri inventati', () => {
    const { container } = render(<DataBadge value={missingValue('utci', 'UTCI', '°C', 'input insufficienti')} />);
    expect(screen.getByText('Dato mancante')).toBeInTheDocument();
    expect(screen.getByText('DATO MANCANTE')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d+(,\d+)? °C/);
  });

  it('mostra l’intervallo con la sua etichetta', () => {
    render(
      <DataBadge
        value={dataValue({ ...estimate, key: 'd', dataClass: 'SIMULATO', value: -1, range: [-2, -0.5], rangeLabel: 'intervallo illustrativo' })}
      />,
    );
    expect(screen.getByText(/intervallo illustrativo: -2 … -0,5 °C/)).toBeInTheDocument();
  });
});
