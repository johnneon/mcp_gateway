import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

describe('Dialog', () => {
  it('opens and closes by accessible name and clears content after close', async () => {
    const user = userEvent.setup();

    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button">Open reveal</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bearer token</DialogTitle>
            <DialogDescription>tok-dialog-once</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.queryByText('tok-dialog-once')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open reveal' }));

    expect(await screen.findByRole('dialog', { name: 'Bearer token' })).toBeInTheDocument();
    expect(screen.getByText('tok-dialog-once')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog', { name: 'Bearer token' })).not.toBeInTheDocument();
    expect(screen.queryByText('tok-dialog-once')).not.toBeInTheDocument();
  });
});
