import type { Duplex } from 'node:stream';
import { DuplexLineSession } from './duplex-lines.js';
import { SMTP_AUTH_FAILED_MESSAGE } from './types.js';

export type SmtpClient = {
  auth(user: string, password: string): Promise<void>;
  quit(): Promise<void>;
  close(): void;
};

/**
 * SMTP client that speaks only over a provided duplex (AUTH only, no send).
 * Does not open TCP or TLS sockets.
 */
export function createSmtpClient(duplex: Duplex): SmtpClient {
  const session = new DuplexLineSession(duplex);
  let greetingDone = false;

  async function ensureGreeting(): Promise<void> {
    if (greetingDone) {
      return;
    }
    const line = await session.readLine();
    if (!line.startsWith('220')) {
      throw new Error('Unexpected SMTP greeting');
    }
    greetingDone = true;
  }

  async function expectCode(prefix: string): Promise<string> {
    const line = await session.readLine();
    if (!line.startsWith(prefix)) {
      throw new Error(line);
    }
    return line;
  }

  return {
    async auth(user, password) {
      await ensureGreeting();
      session.writeLine('EHLO localhost');
      // Read multi-line EHLO replies (250-... then 250 ...)
      for (;;) {
        const line = await session.readLine();
        if (line.startsWith('250 ')) {
          break;
        }
        if (!line.startsWith('250-')) {
          throw new Error(SMTP_AUTH_FAILED_MESSAGE);
        }
      }

      session.writeLine('AUTH LOGIN');
      try {
        await expectCode('334');
        session.writeLine(Buffer.from(user, 'utf8').toString('base64'));
        await expectCode('334');
        session.writeLine(Buffer.from(password, 'utf8').toString('base64'));
        await expectCode('235');
      } catch {
        throw new Error(SMTP_AUTH_FAILED_MESSAGE);
      }
    },

    async quit() {
      try {
        session.writeLine('QUIT');
        await session.readLine();
      } catch {
        // ignore
      }
      session.close();
    },

    close() {
      session.close();
    },
  };
}
