import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('Admin shell', () => {
  it('shows the English gateway heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'MCP Gateway' })).toBeInTheDocument();
    expect(screen.getByText('Admin shell')).toBeInTheDocument();
  });

  it('does not show Configurations or Connectors screens', () => {
    render(<App />);
    expect(screen.queryByText(/configurations/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/connectors/i)).not.toBeInTheDocument();
  });
});
