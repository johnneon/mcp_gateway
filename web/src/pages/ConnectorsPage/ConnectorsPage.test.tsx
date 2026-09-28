import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app';
import { jsonResponse, mockFetch } from '@/test/mockFetch';
import { ConnectorsPage } from './ConnectorsPage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('admin-configurations-ui: Connectors empty state', () => {
  it('Connectors shows empty state without API calls', async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch((url, _init, call) => {
      if (call.method === 'GET' && url === '/api/configurations') {
        return jsonResponse([]);
      }
      throw new Error(`unexpected fetch: ${call.method} ${url}`);
    });

    render(<App />);
    await screen.findByRole('heading', { name: 'Configurations' });
    const callsBefore = calls.length;

    await user.click(screen.getByRole('button', { name: 'Connectors' }));

    expect(screen.getByRole('heading', { name: 'Connectors' })).toBeInTheDocument();
    expect(
      screen.getByText(
        /No connectors yet\. Connector accounts will appear here in a later change\./,
      ),
    ).toBeInTheDocument();
    expect(calls.length).toBe(callsBefore);
  });

  it('renders the empty-state copy on its own', () => {
    const { calls } = mockFetch(() => {
      throw new Error('unexpected fetch');
    });

    render(<ConnectorsPage />);

    expect(screen.getByText(/No connectors yet/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});
