import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('admin-configurations-ui: Admin shell with Configurations and Connectors', () => {
  it('Shell shows both navigation items and no login', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'MCP Gateway' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configurations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connectors' })).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/log in/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
  });

  it('Switching screens does not use a client router', async () => {
    const user = userEvent.setup();
    const pathBefore = window.location.pathname;

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Configurations' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Connectors' }));

    expect(screen.getByRole('heading', { name: 'Connectors' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Configurations' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe(pathBefore);
  });
});
