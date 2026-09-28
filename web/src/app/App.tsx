import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfigurationsPage } from '@/pages/ConfigurationsPage';

export type AdminScreen = 'configurations' | 'connectors';

export function App() {
  const [screen, setScreen] = useState<AdminScreen>('configurations');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">MCP Gateway</h1>
          <nav aria-label="Admin" className="flex gap-2">
            <Button
              type="button"
              variant={screen === 'configurations' ? 'default' : 'outline'}
              aria-current={screen === 'configurations' ? 'page' : undefined}
              onClick={() => {
                setScreen('configurations');
              }}
            >
              Configurations
            </Button>
            <Button
              type="button"
              variant={screen === 'connectors' ? 'default' : 'outline'}
              aria-current={screen === 'connectors' ? 'page' : undefined}
              onClick={() => {
                setScreen('connectors');
              }}
            >
              Connectors
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        {screen === 'configurations' ? (
          <ConfigurationsPage />
        ) : (
          <section aria-labelledby="connectors-heading">
            <h2 id="connectors-heading" className="text-xl font-medium">
              Connectors
            </h2>
          </section>
        )}
      </main>
    </div>
  );
}
