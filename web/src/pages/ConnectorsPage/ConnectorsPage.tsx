import { useCallback, useEffect, useState } from 'react';
import { listConnectors, type ConnectorPublicDescription } from '@/features/connectors/api';
import { ApiError } from '@/shared/api';

const EMPTY_COPY = 'No connectors yet. Connector accounts will appear here in a later change.';

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return 'Something went wrong';
}

function fieldRequiredLabel(required: boolean): string {
  return required ? 'required' : 'optional';
}

export function ConnectorsPage() {
  const [items, setItems] = useState<ConnectorPublicDescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listConnectors();
      setItems(rows);
    } catch (err) {
      setError(errorMessage(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  return (
    <section aria-labelledby="connectors-heading" className="space-y-4">
      <h2 id="connectors-heading" className="text-xl font-medium">
        Connectors
      </h2>

      {error !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Loading connectors…</p> : null}

      {!loading && items.length === 0 && error === null ? <p>{EMPTY_COPY}</p> : null}

      {!loading && items.length > 0 ? (
        <ul className="space-y-4">
          {items.map((connector) => (
            <li key={connector.id} className="space-y-2">
              <p className="font-medium">{connector.name}</p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {connector.fields.map((field) => (
                  <li key={field.name}>
                    {field.label} — {field.type} — {fieldRequiredLabel(field.required)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
