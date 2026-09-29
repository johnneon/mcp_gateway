import { Duplex } from 'node:stream';

export type FakeSmtpOptions = {
  user: string;
  password: string;
  acceptAuth?: boolean;
};

/**
 * In-process fake SMTP server as a Duplex (AUTH LOGIN only).
 * Does not open a TCP socket.
 */
export function createFakeSmtpDuplex(options: FakeSmtpOptions): Duplex {
  const acceptAuth = options.acceptAuth !== false;
  let buffer = '';
  let stage: 'greeting' | 'ehlo' | 'auth' | 'user' | 'pass' | 'done' = 'greeting';

  const duplex = new Duplex({
    read() {
      // push-driven
    },
    write(chunk: Buffer | string, _encoding, callback) {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      processBuffer();
      callback();
    },
  });

  queueMicrotask(() => {
    duplex.push('220 fake.smtp.test ESMTP\r\n');
  });
  stage = 'ehlo';

  function respond(line: string): void {
    duplex.push(`${line}\r\n`);
  }

  function processBuffer(): void {
    for (;;) {
      const idx = buffer.indexOf('\r\n');
      if (idx < 0) {
        return;
      }
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      handle(line);
    }
  }

  function handle(line: string): void {
    const upper = line.toUpperCase();
    if (stage === 'ehlo' && upper.startsWith('EHLO')) {
      respond('250-fake.smtp.test');
      respond('250-AUTH LOGIN');
      respond('250 OK');
      stage = 'auth';
      return;
    }
    if (stage === 'auth' && upper === 'AUTH LOGIN') {
      respond('334 VXNlcm5hbWU6');
      stage = 'user';
      return;
    }
    if (stage === 'user') {
      const user = Buffer.from(line, 'base64').toString('utf8');
      if (user !== options.user) {
        respond('535 Authentication failed');
        stage = 'done';
        return;
      }
      respond('334 UGFzc3dvcmQ6');
      stage = 'pass';
      return;
    }
    if (stage === 'pass') {
      const password = Buffer.from(line, 'base64').toString('utf8');
      if (!acceptAuth || password !== options.password) {
        respond('535 Authentication failed');
        stage = 'done';
        return;
      }
      respond('235 Authentication successful');
      stage = 'done';
      return;
    }
    if (upper === 'QUIT') {
      respond('221 Bye');
      duplex.push(null);
      return;
    }
    respond('500 unrecognized');
  }

  return duplex;
}
