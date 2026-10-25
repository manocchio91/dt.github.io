import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnboardingPage } from '../pages/OnboardingPage';
import { renderApp } from './utils';

beforeEach(() => localStorage.clear());

async function answer(user: ReturnType<typeof userEvent.setup>, name: RegExp | null, role: 'radio' | 'checkbox' = 'radio') {
  if (name) await user.click(screen.getByRole(role, { name }));
  await user.click(screen.getByRole('button', { name: /^Continua$/ }));
}

describe('Guida in 6 domande — usabilità (Audit Anno Luce)', () => {
  const progress = () => screen.getByTestId('onboarding-progress').textContent;
  const primaries = () => Array.from(document.querySelectorAll('form .btn-primary'));

  it('una domanda per schermata, avanzamento da 1 di 6 a 6 di 6, una sola azione primaria “Continua”', async () => {
    const user = userEvent.setup();
    renderApp(<OnboardingPage />, { route: '/benvenuto', path: '/benvenuto' });
    const steps: [RegExp | null, 'radio' | 'checkbox'][] = [[/Tecnico comunale/, 'radio'], [null, 'radio'], [/Individuare le zone/, 'radio'], [/Area dimostrativa/, 'radio'], [null, 'checkbox'], [/Guidata/, 'radio']];
    for (const [i, [opt, role]] of steps.entries()) {
      expect(progress()).toBe(`Domanda ${i + 1} di 6`);
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(primaries()).toHaveLength(1);
      expect(primaries()[0]).toHaveTextContent('Continua');
      expect(screen.getByRole('button', { name: 'Indietro' })).toHaveClass('btn-secondary');
      await answer(user, opt, role);
    }
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/\/urbano$/));
  });

  it('tornando indietro le risposte restano; si esce e si riprende dalla stessa domanda', async () => {
    const user = userEvent.setup();
    const first = renderApp(<OnboardingPage />, { route: '/benvenuto', path: '/benvenuto' });
    await answer(user, /Agricoltore/);
    await answer(user, null);
    await answer(user, /Tenere conto della fase/);
    await user.click(screen.getByRole('button', { name: 'Indietro' }));
    expect(screen.getByRole('radio', { name: /Tenere conto della fase/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Continua' }));
    await user.click(screen.getByRole('button', { name: 'Esci e riprendi dopo' }));
    first.unmount();

    renderApp(<OnboardingPage />, { route: '/benvenuto', path: '/benvenuto' });
    expect(progress()).toBe('Domanda 4 di 6');
    expect(screen.getByRole('status')).toHaveTextContent(/ripreso la guida/);
    await user.click(screen.getByRole('button', { name: 'Indietro' }));
    expect(screen.getByRole('radio', { name: /Tenere conto della fase/ })).toBeChecked();
  });

  it('la bozza non trasporta permessi: un campo “role” iniettato viene scartato', async () => {
    localStorage.setItem('mdt:onboarding:bozza', JSON.stringify({ step: 1, draft: { profile: 'revisore', role: 'admin', data: [] } }));
    const user = userEvent.setup();
    renderApp(<OnboardingPage />, { route: '/benvenuto', path: '/benvenuto' });
    expect(progress()).toBe('Domanda 2 di 6');
    await user.click(screen.getByRole('radio', { name: /Città/ }));
    expect(JSON.parse(localStorage.getItem('mdt:onboarding:bozza')!).draft).not.toHaveProperty('role');
  });

  it('opzioni adattate al percorso: cinque decisioni urbane, sei agricole', async () => {
    const user = userEvent.setup();
    const r = renderApp(<OnboardingPage />, { route: '/benvenuto', path: '/benvenuto' });
    await answer(user, /Tecnico comunale/);
    await answer(user, null);
    expect(screen.getAllByRole('radio').map((x) => x.closest('label')!.querySelector('.font-bold')!.textContent)).toEqual([
      'Individuare le zone più esposte al caldo',
      'Controllare una piazza, una strada o un parco',
      'Confrontare possibili interventi',
      'Tenere d’occhio una soglia di caldo',
      'Verificare gli effetti di un intervento già fatto',
    ]);
    r.unmount();
    localStorage.clear();
    renderApp(<OnboardingPage />, { route: '/benvenuto', path: '/benvenuto' });
    await answer(user, /Agricoltore/);
    await answer(user, null);
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    expect(screen.getByRole('radio', { name: /Verificare una soglia indicata dall’agronomo/ })).toBeInTheDocument();
    expect(screen.getByText(/Ogni scelta su acqua o trattamenti resta tua e dell’agronomo/)).toBeInTheDocument();
  });
});
