import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app';
import { jsonResponse, mockFetch, textResponse } from '@/test/mockFetch';
import { ConnectorsPage } from './ConnectorsPage';

afterEach(() => {
  vi.unstubAllGlobals();
});

function assertNoAccountActions(): void {
  expect(screen.queryByRole('button', { name: /add/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /check/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /disable/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
}

describe('admin-configurations-ui: Connectors list from API', () => {
  it('Empty API list keeps the empty-state copy', async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch((url, _init, call) => {
      if (call.method === 'GET' && url === '/api/configurations') {
        return jsonResponse([]);
      }
      if (call.method === 'GET' && url === '/api/connectors') {
        return jsonResponse([]);
      }
      throw new Error(`unexpected fetch: ${call.method} ${url}`);
    });

    render(<App />);
    await screen.findByRole('heading', { name: 'Configurations' });

    await user.click(screen.getByRole('button', { name: 'Connectors' }));

    expect(screen.getByRole('heading', { name: 'Connectors' })).toBeInTheDocument();
    expect(
      await screen.findByText(
        'No connectors yet. Connector accounts will appear here in a later change.',
      ),
    ).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'GET' && call.url === '/api/connectors')).toBe(
      true,
    );
    assertNoAccountActions();
  });

  it('Non-empty list shows name and fields without account actions', async () => {
    mockFetch((url, _init, call) => {
      if (call.method === 'GET' && url === '/api/connectors') {
        return jsonResponse([
          {
            id: 'fake',
            name: 'Fake',
            kind: 'native',
            fields: [{ name: 'token', label: 'Token', type: 'secret', required: true }],
          },
        ]);
      }
      throw new Error(`unexpected fetch: ${call.method} ${url}`);
    });

    render(<ConnectorsPage />);

    expect(await screen.findByText('Fake')).toBeInTheDocument();
    expect(screen.getByText(/Token/)).toBeInTheDocument();
    expect(screen.getByText(/secret/)).toBeInTheDocument();
    expect(screen.getByText(/required/)).toBeInTheDocument();
    assertNoAccountActions();
    expect(screen.queryByText('super-secret-token-value')).not.toBeInTheDocument();
  });
});

describe('admin-configurations-ui: Show English errors from failed connectors list', () => {
  it('Connectors list error is shown in English', async () => {
    mockFetch((url, _init, call) => {
      if (call.method === 'GET' && url === '/api/connectors') {
        return textResponse('Connectors unavailable', 500);
      }
      throw new Error(`unexpected fetch: ${call.method} ${url}`);
    });

    render(<ConnectorsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/Connectors unavailable/i);
    expect(screen.queryByText('super-secret-token-value')).not.toBeInTheDocument();
  });
});
