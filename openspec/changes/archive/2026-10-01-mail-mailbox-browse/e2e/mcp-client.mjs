/**
 * Throwaway MCP and admin API walk for mail-mailbox-browse.
 * Uses the change's fake IMAP/SMTP egress. Does not contact live Gmail or Mail.ru.
 * Run from the repo root:
 *   node node_modules/vite-node/vite-node.mjs openspec/changes/mail-mailbox-browse/e2e/mcp-client.mjs
 */
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { gmailConnector } from '../../../../server/src/connectors/gmail/index.js';
import { mailruConnector } from '../../../../server/src/connectors/mailru/index.js';
import {
  buildConnectorRegistry,
  productionConnectorRegistry,
} from '../../../../server/src/connectors/registry.js';
import { createAdminApp } from '../../../../server/src/http/createAdminApp.js';
import { createMcpApp } from '../../../../server/src/http/createMcpApp.js';
import { hashToken } from '../../../../server/src/token/token.js';
import { createGmailFakeEgressTransport } from '../../../../server/test/connectors/gmail/fake-egress.js';
import { createMailruFakeEgressTransport } from '../../../../server/test/connectors/mailru/fake-egress.js';

const FIXTURE_PASSWORD = 'mailbox-e2e-fixture-password-UNIQUE';
const UNKNOWN_BEARER = 'unknown-bearer-UNIQUE';
const results = [];

const specs = [
  {
    id: 'gmail',
    prefix: 'gmail',
    address: 'user@gmail.com',
    host: 'imap.gmail.com',
    bearer: 'gmail-e2e-bearer-UNIQUE',
    accountId: 'gmail-e2e-acc',
    foreignId: 'gmail-e2e-foreign',
    disabledId: 'gmail-e2e-disabled',
    connector: gmailConnector,
    createTransport: createGmailFakeEgressTransport,
  },
  {
    id: 'mailru',
    prefix: 'mailru',
    address: 'user@mail.ru',
    host: 'imap.mail.ru',
    bearer: 'mailru-e2e-bearer-UNIQUE',
    accountId: 'mailru-e2e-acc',
    foreignId: 'mailru-e2e-foreign',
    disabledId: 'mailru-e2e-disabled',
    connector: mailruConnector,
    createTransport: createMailruFakeEgressTransport,
  },
];

function pass(name, detail) {
  results.push({ name, ok: true, detail });
  console.log(`PASS ${name} — ${detail}`);
}

function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.error(`FAIL ${name} — ${detail}`);
}

function errorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function scenario(name, run) {
  try {
    const detail = await run();
    pass(name, detail);
  } catch (error) {
    fail(name, errorMessage(error));
  }
}

function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createMemoryStore(initial = {}) {
  let document = structuredClone(initial);
  return {
    read() {
      return structuredClone(document);
    },
    replace(next) {
      document = structuredClone(next);
      return Promise.resolve();
    },
  };
}

function note(uid, subject, date = '01 Jan 2024 00:00:00 +0000', extra = {}) {
  return {
    uid,
    from: 'alice@example.test',
    to: 'me@example.test',
    subject,
    date,
    seen: false,
    textBody: `body ${subject}`,
    ...extra,
  };
}

function defaultNewestInbox() {
  const messages = [
    note(1, 'Subject 1', '01 Feb 2024 00:00:00 +0000', { seen: true }),
  ];
  for (let uid = 2; uid <= 21; uid += 1) {
    const day = String(uid - 1).padStart(2, '0');
    messages.push(note(uid, `Subject ${String(uid)}`, `${day} Jan 2024 00:00:00 +0000`));
  }
  return messages;
}

function sameDateMessages(count) {
  const messages = [];
  for (let uid = 1; uid <= count; uid += 1) {
    messages.push(note(uid, `Subject ${String(uid)}`, '01 Jan 2024 00:00:00 +0000'));
  }
  return messages;
}

function attachedMessage(uid) {
  return note(uid, 'With attachment', '01 Jan 2024 00:00:00 +0000', {
    seen: true,
    textBody: 'Readable text body',
    htmlBody: '<p>Readable html</p>',
    attachments: [{ name: 'file.bin', contentType: 'application/octet-stream', bytes: 'file-bytes' }],
  });
}

function storeFor(spec) {
  return createMemoryStore({
    accounts: [
      {
        id: spec.accountId,
        connector: spec.id,
        label: 'Personal',
        enabled: true,
        values: { address: spec.address, password: FIXTURE_PASSWORD },
      },
      {
        id: spec.foreignId,
        connector: spec.id,
        label: 'Foreign',
        enabled: true,
        values: { address: spec.address, password: FIXTURE_PASSWORD },
      },
      {
        id: spec.disabledId,
        connector: spec.id,
        label: 'Disabled',
        enabled: false,
        values: { address: spec.address, password: FIXTURE_PASSWORD },
      },
    ],
    configurations: [
      {
        id: `${spec.id}-cfg`,
        name: `${spec.id} config`,
        tokenHash: hashToken(spec.bearer),
        enabled: true,
        accountIds: [spec.accountId, spec.disabledId],
      },
    ],
  });
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
    server.once('error', reject);
  });
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${String(address.port)}` };
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function withClient(baseUrl, token, run) {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'e2e-mail-mailbox-browse', version: '0.0.0' });
  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

async function session(spec, imap, run) {
  const egress = spec.createTransport({
    imap: { user: spec.address, password: FIXTURE_PASSWORD, ...imap },
    smtp: { user: spec.address, password: FIXTURE_PASSWORD },
  });
  const app = createMcpApp({
    store: storeFor(spec),
    connectorRegistry: buildConnectorRegistry([spec.connector]),
    egressTransport: egress,
  });
  const listened = await listen(app);
  try {
    return await withClient(listened.baseUrl, spec.bearer, (client) => run(client, egress));
  } finally {
    await closeServer(listened.server);
  }
}

function toolText(result) {
  const record = result;
  return record.content?.map((part) => part.text ?? '').join('\n') ?? JSON.stringify(result);
}

async function callText(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = toolText(result);
  check(!text.includes(FIXTURE_PASSWORD), 'fixture password leaked in result');
  return text;
}

async function expectFail(client, name, args) {
  try {
    await client.callTool({ name, arguments: args });
  } catch (error) {
    const message = errorMessage(error);
    check(!message.includes(FIXTURE_PASSWORD), 'fixture password leaked in error');
    return message;
  }
  throw new Error(`expected ${name} to fail`);
}

function parseEnvelope(text) {
  const parsed = JSON.parse(text);
  check(!Array.isArray(parsed), 'result is an array');
  check(Array.isArray(parsed.messages), 'messages missing');
  return parsed;
}

function uids(envelope) {
  return envelope.messages.map((message) => message.uid);
}

function summaryShape(message) {
  for (const key of ['uid', 'from', 'to', 'subject', 'date', 'seen', 'unread']) {
    check(Object.hasOwn(message, key), `summary missing ${key}`);
  }
  check(!Object.hasOwn(message, 'textBody'), 'summary has textBody');
  check(!Object.hasOwn(message, 'htmlBody'), 'summary has htmlBody');
}

function tool(spec, short) {
  return `${spec.prefix}_${short}`;
}

function acc(spec, extra = {}) {
  return { account: spec.accountId, ...extra };
}

async function listText(client, spec, mailbox) {
  const args = acc(spec);
  if (mailbox !== undefined) {
    args.mailbox = mailbox;
  }
  return callText(client, tool(spec, 'list_messages'), args);
}

async function runConnector(spec) {
  const label = spec.prefix;

  await scenario(`${label}: Default call returns the full newest set inside an envelope`, async () => {
    return session(spec, { messages: defaultNewestInbox() }, async (client) => {
      const envelope = parseEnvelope(await listText(client, spec));
      check(envelope.offset === 0 && envelope.limit === null && envelope.total === 21, 'envelope');
      check(envelope.messages.length === 21, 'length');
      check(envelope.messages[0].uid === 1, 'first uid');
      check(envelope.messages[0].to === 'me@example.test', 'to');
      check(envelope.messages[0].seen === true && envelope.messages[0].unread === false, 'seen');
      check(envelope.messages.at(-1).uid === 2, 'last uid');
      check(envelope.messages.at(-1).seen === false && envelope.messages.at(-1).unread === true, 'unread');
      for (const message of envelope.messages) {
        summaryShape(message);
      }
      return '21 newest summaries, limit null, no body';
    });
  });

  await scenario(`${label}: Offset and both orders page a mailbox`, async () => {
    return session(
      spec,
      {
        messages: [
          note(5, 'a', '04 Jan 2024 00:00:00 +0000'),
          note(6, 'b', '01 Jan 2024 00:00:00 +0000'),
          note(7, 'c', '03 Jan 2024 00:00:00 +0000'),
          note(8, 'd', '02 Jan 2024 00:00:00 +0000'),
        ],
      },
      async (client) => {
        const newest = parseEnvelope(
          await callText(client, tool(spec, 'list_messages'), acc(spec, { limit: 2, offset: 0, order: 'newest' })),
        );
        check(JSON.stringify(uids(newest)) === JSON.stringify([5, 7]), `newest ${uids(newest).join(',')}`);
        const newestRest = parseEnvelope(
          await callText(client, tool(spec, 'list_messages'), acc(spec, { limit: 2, offset: 2, order: 'newest' })),
        );
        check(JSON.stringify(uids(newestRest)) === JSON.stringify([8, 6]), 'newest rest');
        const oldest = parseEnvelope(
          await callText(client, tool(spec, 'list_messages'), acc(spec, { limit: 2, offset: 0, order: 'oldest' })),
        );
        check(JSON.stringify(uids(oldest)) === JSON.stringify([6, 8]), 'oldest');
        const oldestRest = parseEnvelope(
          await callText(client, tool(spec, 'list_messages'), acc(spec, { limit: 2, offset: 2, order: 'oldest' })),
        );
        check(JSON.stringify(uids(oldestRest)) === JSON.stringify([7, 5]), 'oldest rest');
        check(oldest.messages[0].to === 'me@example.test', 'to');
        return 'pages 5,7 / 8,6 and 6,8 / 7,5';
      },
    );
  });

  await scenario(`${label}: List returns capped summaries without bodies on a fake IMAP server`, async () => {
    return session(spec, { messages: sameDateMessages(60) }, async (client) => {
      const envelope = parseEnvelope(
        await callText(client, tool(spec, 'list_messages'), acc(spec, { limit: 80 })),
      );
      check(envelope.limit === 80 && envelope.total === 60 && envelope.messages.length === 60, 'uncapped');
      check(envelope.messages[0].uid === 60 && envelope.messages.at(-1).uid === 1, 'uid order');
      summaryShape(envelope.messages[0]);
      return 'limit 80 returned 60, uid 60 down to 1';
    });
  });

  await scenario(`${label}: Provided limit is honored with no maximum`, async () => {
    return session(spec, { messages: sameDateMessages(60) }, async (client) => {
      const envelope = parseEnvelope(
        await callText(client, tool(spec, 'list_messages'), acc(spec, { limit: 2, offset: 0, order: 'oldest' })),
      );
      check(envelope.limit === 2 && JSON.stringify(uids(envelope)) === JSON.stringify([1, 2]), 'page');
      return 'oldest limit 2 is uids 1 then 2';
    });
  });

  await scenario(`${label}: Unparseable dates sort as oldest`, async () => {
    return session(
      spec,
      {
        messages: [
          note(1, 'bad', 'not-a-date'),
          note(2, 'good', '02 Jan 2024 00:00:00 +0000'),
          note(3, 'bad2', 'not-a-date'),
        ],
      },
      async (client) => {
        const newest = parseEnvelope(
          await callText(client, tool(spec, 'list_messages'), acc(spec, { order: 'newest' })),
        );
        check(newest.limit === null && JSON.stringify(uids(newest)) === JSON.stringify([2, 3, 1]), 'newest');
        const oldest = parseEnvelope(
          await callText(client, tool(spec, 'list_messages'), acc(spec, { order: 'oldest' })),
        );
        check(JSON.stringify(uids(oldest)) === JSON.stringify([1, 3, 2]), 'oldest');
        return 'unparseable dates sort oldest, higher uid first';
      },
    );
  });

  await scenario(`${label}: Invalid offset and limit return the full remainder`, async () => {
    return session(spec, { messages: [note(1, 'only')] }, async (client) => {
      const zero = parseEnvelope(
        await callText(client, tool(spec, 'list_messages'), acc(spec, { limit: 0, offset: -1 })),
      );
      check(zero.offset === 0 && zero.limit === null && zero.messages.length === 1, 'zero');
      const fractional = parseEnvelope(
        await callText(client, tool(spec, 'list_messages'), acc(spec, { limit: 1.5, offset: -4 })),
      );
      check(fractional.offset === 0 && fractional.limit === null && fractional.messages.length === 1, 'fraction');
      return 'limit 0 and 1.5 return the remainder';
    });
  });

  await scenario(`${label}: Offset past the end returns an empty page`, async () => {
    return session(spec, { messages: [note(1, 'only')] }, async (client) => {
      const limited = parseEnvelope(
        await callText(client, tool(spec, 'list_messages'), acc(spec, { offset: 5, limit: 20 })),
      );
      check(limited.offset === 5 && limited.limit === 20 && limited.total === 1 && limited.messages.length === 0, 'limited');
      const open = parseEnvelope(
        await callText(client, tool(spec, 'list_messages'), acc(spec, { offset: 5 })),
      );
      check(open.limit === null && open.messages.length === 0 && open.total === 1, 'open');
      return 'offset 5 yields an empty page';
    });
  });

  await scenario(`${label}: Unknown order is rejected`, async () => {
    return session(spec, { messages: [note(1, 'only')] }, async (client, egress) => {
      const message = await expectFail(client, tool(spec, 'list_messages'), acc(spec, { order: 'random' }));
      check(message.includes('Invalid order'), message);
      check(egress.searchCommandCount === 0, 'SEARCH was issued');
      return 'Invalid order, SEARCH not issued';
    });
  });

  await scenario(`${label}: Sent, Drafts, Spam, and Trash are listed by server mailbox name`, async () => {
    return session(
      spec,
      {
        messages: [note(1, 'Inbox note')],
        mailboxes: [
          { name: 'Sent Items', attributes: ['\\Sent'], messages: [note(2, 'Sent note')] },
          { name: 'Drafts', attributes: ['\\Drafts'], messages: [note(3, 'Draft note')] },
          { name: 'Spam', attributes: ['\\Junk'], messages: [note(4, 'Spam note')] },
          { name: 'Deleted Items', attributes: ['\\Trash'], messages: [note(5, 'Trash note')] },
        ],
      },
      async (client) => {
        const listed = JSON.parse(await callText(client, tool(spec, 'list_mailboxes'), acc(spec)));
        const sent = listed.find((mailbox) => mailbox.specialUse === 'sent');
        check(sent.name === 'Sent Items', sent.name);
        const sentPage = parseEnvelope(
          await callText(client, tool(spec, 'list_messages'), acc(spec, { mailbox: sent.name })),
        );
        const subjects = sentPage.messages.map((message) => message.subject);
        check(subjects.includes('Sent note') && !subjects.includes('Inbox note'), subjects.join(','));
        for (const [use, subject] of [
          ['drafts', 'Draft note'],
          ['junk', 'Spam note'],
          ['trash', 'Trash note'],
        ]) {
          const name = listed.find((mailbox) => mailbox.specialUse === use).name;
          const page = parseEnvelope(
            await callText(client, tool(spec, 'list_messages'), acc(spec, { mailbox: name })),
          );
          check(page.messages.some((message) => message.subject === subject), subject);
        }
        const blob = JSON.stringify(listed) + subjects.join(' ');
        check(!blob.includes('[Gmail]/'), 'hard-coded Gmail folder');
        return 'Sent Items, Drafts, Spam, Deleted Items';
      },
    );
  });

  await scenario(`${label}: Narrow filter search returns matching summaries on a fake IMAP server`, async () => {
    return session(
      spec,
      {
        messages: [
          note(1, 'from alice', '01 Jan 2024 00:00:00 +0000'),
          note(2, 'from bob', '02 Jan 2024 00:00:00 +0000', { from: 'bob@example.test' }),
        ],
      },
      async (client) => {
        const envelope = parseEnvelope(
          await callText(client, tool(spec, 'search_messages'), acc(spec, { filter: { from: 'alice@example.test' } })),
        );
        check(envelope.offset === 0 && envelope.limit === null, 'envelope');
        check(envelope.total === envelope.messages.length, 'total');
        check(envelope.messages.every((message) => message.from === 'alice@example.test'), 'filter');
        check(envelope.messages.length === 1, 'count');
        summaryShape(envelope.messages[0]);
        return 'one alice summary, limit null';
      },
    );
  });

  await scenario(`${label}: Search applies paging and order after the filter`, async () => {
    return session(
      spec,
      {
        messages: [
          note(1, 'a', '03 Jan 2024 00:00:00 +0000'),
          note(2, 'b', '04 Jan 2024 00:00:00 +0000', { from: 'bob@example.test' }),
          note(3, 'c', '01 Jan 2024 00:00:00 +0000'),
          note(4, 'd', '02 Jan 2024 00:00:00 +0000'),
        ],
      },
      async (client) => {
        const oldest = parseEnvelope(
          await callText(
            client,
            tool(spec, 'search_messages'),
            acc(spec, { filter: { from: 'alice@example.test' }, order: 'oldest', limit: 2, offset: 0 }),
          ),
        );
        check(oldest.total === 3 && JSON.stringify(uids(oldest)) === JSON.stringify([3, 4]), 'oldest');
        check(oldest.messages.every((message) => message.from !== 'bob@example.test'), 'bob');
        const newest = parseEnvelope(
          await callText(
            client,
            tool(spec, 'search_messages'),
            acc(spec, { filter: { from: 'alice@example.test' }, order: 'newest', limit: 2, offset: 2 }),
          ),
        );
        check(newest.total === 3 && JSON.stringify(uids(newest)) === JSON.stringify([3]), 'newest rest');
        return 'alice oldest 3,4 then newest remainder 3';
      },
    );
  });

  await scenario(`${label}: Unknown search order is rejected`, async () => {
    return session(spec, { messages: [note(1, 'only')] }, async (client, egress) => {
      const message = await expectFail(
        client,
        tool(spec, 'search_messages'),
        acc(spec, { order: 'random', filter: { from: 'alice@example.test' } }),
      );
      check(message.includes('Invalid order'), message);
      check(egress.searchCommandCount === 0, 'SEARCH was issued');
      return 'Invalid order, SEARCH not issued';
    });
  });

  await scenario(`${label}: Free-form IMAP search syntax is rejected`, async () => {
    return session(spec, { messages: [note(1, 'only')] }, async (client, egress) => {
      const stringError = await expectFail(
        client,
        tool(spec, 'search_messages'),
        acc(spec, { filter: 'OR FROM alice SUBJECT secret' }),
      );
      check(!stringError.includes(FIXTURE_PASSWORD), 'password');
      const rawError = await expectFail(
        client,
        tool(spec, 'search_messages'),
        acc(spec, { filter: { raw: 'BEFORE 1-Jan-2020' } }),
      );
      check(!rawError.includes(FIXTURE_PASSWORD), 'password');
      check(egress.searchCommandCount === 0 && egress.tlsSessionCallCount === 0, 'SEARCH issued');
      return 'free-form string and unknown filter key rejected';
    });
  });

  await scenario(`${label}: Read returns headers and text body without attachment bytes`, async () => {
    return session(spec, { messages: [attachedMessage(42)] }, async (client) => {
      const text = await callText(client, tool(spec, 'read_message'), acc(spec, { uid: 42 }));
      check(!text.includes('file-bytes') && !text.includes('attachmentNames'), 'bytes leaked');
      const parsed = JSON.parse(text);
      check(parsed.textBody === 'Readable text body' && parsed.htmlBody === '<p>Readable html</p>', 'bodies');
      check(parsed.attachments.length === 1 && parsed.attachments[0].size === 10, 'meta');
      check(!Object.hasOwn(parsed, 'data'), 'data field');
      return 'html and attachment metadata, no bytes';
    });
  });

  await scenario(`${label}: Missing HTML part yields an empty string`, async () => {
    return session(spec, { messages: [note(7, 'plain', '01 Jan 2024 00:00:00 +0000', { textBody: 'Plain only' })] }, async (client) => {
      const parsed = JSON.parse(await callText(client, tool(spec, 'read_message'), acc(spec, { uid: 7 })));
      check(parsed.textBody === 'Plain only' && parsed.htmlBody === '' && parsed.attachments.length === 0, 'plain');
      return 'htmlBody empty string';
    });
  });

  await scenario(`${label}: Attachment is returned as base64`, async () => {
    return session(spec, { messages: [attachedMessage(42)] }, async (client) => {
      const parsed = JSON.parse(
        await callText(client, tool(spec, 'get_attachment'), acc(spec, { uid: 42, index: 0 })),
      );
      check(parsed.data === 'ZmlsZS1ieXRlcw==' && parsed.size === 10 && parsed.name === 'file.bin', JSON.stringify(parsed));
      return 'data ZmlsZS1ieXRlcw==';
    });
  });

  await scenario(`${label}: Missing attachment is not found`, async () => {
    return session(spec, { messages: [note(42, 'none')] }, async (client) => {
      const message = await expectFail(client, tool(spec, 'get_attachment'), acc(spec, { uid: 42, index: 0 }));
      check(message.includes('Attachment not found'), message);
      return message;
    });
  });

  await scenario(`${label}: Attachment index below 0 is rejected`, async () => {
    return session(spec, { messages: [attachedMessage(42)] }, async (client) => {
      const message = await expectFail(client, tool(spec, 'get_attachment'), acc(spec, { uid: 42, index: -1 }));
      check(message.includes('Attachment index is required'), message);
      return message;
    });
  });

  await scenario(`${label}: Get attachment uid below 1 is rejected`, async () => {
    return session(spec, { messages: [attachedMessage(42)] }, async (client) => {
      const message = await expectFail(client, tool(spec, 'get_attachment'), acc(spec, { uid: 0, index: 0 }));
      check(message.includes('uid is required'), message);
      return message;
    });
  });

  await scenario(`${label}: Set seen and flagged`, async () => {
    return session(spec, { messages: [note(7, 'flags')] }, async (client) => {
      const parsed = JSON.parse(
        await callText(client, tool(spec, 'update_flags'), acc(spec, { uid: 7, seen: true, flagged: true })),
      );
      check(parsed.seen === true && parsed.flagged === true, JSON.stringify(parsed));
      const envelope = parseEnvelope(await listText(client, spec));
      const row = envelope.messages.find((message) => message.uid === 7);
      check(row.seen === true && row.unread === false, 'list');
      return 'seen and flagged true';
    });
  });

  await scenario(`${label}: Clear seen and flagged`, async () => {
    return session(spec, { messages: [note(7, 'flags', '01 Jan 2024 00:00:00 +0000', { seen: true, flagged: true })] }, async (client) => {
      const parsed = JSON.parse(
        await callText(client, tool(spec, 'update_flags'), acc(spec, { uid: 7, seen: false, flagged: false })),
      );
      check(parsed.seen === false && parsed.flagged === false, JSON.stringify(parsed));
      const envelope = parseEnvelope(await listText(client, spec));
      const row = envelope.messages.find((message) => message.uid === 7);
      check(row.seen === false && row.unread === true, 'list');
      return 'seen and flagged false';
    });
  });

  await scenario(`${label}: Omitted flag stays unchanged`, async () => {
    return session(spec, { messages: [note(7, 'flags', '01 Jan 2024 00:00:00 +0000', { seen: true })] }, async (client) => {
      const added = JSON.parse(
        await callText(client, tool(spec, 'update_flags'), acc(spec, { uid: 7, flagged: true })),
      );
      check(added.seen === true && added.flagged === true, 'add');
      const cleared = JSON.parse(
        await callText(client, tool(spec, 'update_flags'), acc(spec, { uid: 7, seen: false })),
      );
      check(cleared.seen === false && cleared.flagged === true, 'omit flagged');
      return 'omitted flag unchanged';
    });
  });

  await scenario(`${label}: Flag is required`, async () => {
    return session(spec, { messages: [note(7, 'flags', '01 Jan 2024 00:00:00 +0000', { seen: true })] }, async (client) => {
      const message = await expectFail(client, tool(spec, 'update_flags'), acc(spec, { uid: 7 }));
      check(message.includes('Flag is required'), message);
      const envelope = parseEnvelope(await listText(client, spec));
      const row = envelope.messages.find((entry) => entry.uid === 7);
      check(row.seen === true && row.unread === false, 'unchanged');
      const kept = JSON.parse(
        await callText(client, tool(spec, 'update_flags'), acc(spec, { uid: 7, seen: true })),
      );
      check(kept.flagged === false, 'flagged stayed false');
      return 'Flag is required, then seen-only leaves flagged false';
    });
  });

  await scenario(`${label}: Update flags uid below 1 is rejected`, async () => {
    return session(spec, { messages: [note(7, 'flags')] }, async (client) => {
      const message = await expectFail(client, tool(spec, 'update_flags'), acc(spec, { uid: 0, seen: true }));
      check(message.includes('uid is required'), message);
      const envelope = parseEnvelope(await listText(client, spec));
      check(envelope.messages.find((entry) => entry.uid === 7).seen === false, 'unchanged');
      return message;
    });
  });

  await scenario(`${label}: List mailboxes returns name and special use`, async () => {
    return session(
      spec,
      {
        messages: [],
        mailboxes: [
          { name: 'Sent Items', attributes: ['\\Sent'], messages: [] },
          { name: 'Drafts', attributes: ['\\Drafts'], messages: [] },
          { name: 'Spam', attributes: ['\\Junk'], messages: [] },
          { name: 'Deleted Items', attributes: ['\\Trash'], messages: [] },
          { name: 'Old Mail', attributes: ['\\Archive'], messages: [] },
          { name: 'Starred', attributes: ['\\Flagged'], messages: [] },
          { name: 'Everything', attributes: ['\\All'], messages: [] },
          { name: 'Projects', attributes: [], messages: [] },
        ],
      },
      async (client) => {
        const text = await callText(client, tool(spec, 'list_mailboxes'), acc(spec));
        check(!text.includes(spec.host) && !text.includes('[Gmail]/'), 'host leaked');
        const listed = JSON.parse(text);
        check(listed.length === 9, `count ${listed.length}`);
        const byName = Object.fromEntries(listed.map((mailbox) => [mailbox.name, mailbox.specialUse]));
        check(byName.INBOX === 'inbox', 'inbox');
        check(byName['Sent Items'] === 'sent', 'sent');
        check(byName.Drafts === 'drafts', 'drafts');
        check(byName.Spam === 'junk', 'junk');
        check(byName['Deleted Items'] === 'trash', 'trash');
        check(byName['Old Mail'] === 'archive', 'archive');
        check(byName.Starred === 'flagged', 'flagged');
        check(byName.Everything === 'all', 'all');
        check(byName.Projects === 'none', 'none');
        return 'nine mailboxes, no host';
      },
    );
  });

  await scenario(`${label}: Create mailbox adds a folder`, async () => {
    return session(spec, { messages: [] }, async (client) => {
      const created = JSON.parse(await callText(client, tool(spec, 'create_mailbox'), acc(spec, { name: 'Projects' })));
      check(created.name === 'Projects', 'name');
      const listed = JSON.parse(await callText(client, tool(spec, 'list_mailboxes'), acc(spec)));
      const projects = listed.find((mailbox) => mailbox.name === 'Projects');
      check(projects && projects.specialUse === 'none', 'listed');
      return 'Projects specialUse none';
    });
  });

  await scenario(`${label}: Empty mailbox name is rejected`, async () => {
    return session(spec, { messages: [] }, async (client, egress) => {
      const before = egress.tlsSessionCallCount;
      const empty = await expectFail(client, tool(spec, 'create_mailbox'), acc(spec, { name: '' }));
      const blank = await expectFail(client, tool(spec, 'create_mailbox'), acc(spec, { name: '   ' }));
      check(empty.includes('Mailbox name is required') && blank.includes('Mailbox name is required'), empty);
      check(egress.tlsSessionCallCount === before, 'CREATE session opened');
      const listed = JSON.parse(await callText(client, tool(spec, 'list_mailboxes'), acc(spec)));
      check(!listed.some((mailbox) => mailbox.name.trim() === ''), 'empty name listed');
      return 'Mailbox name is required';
    });
  });

  await scenario(`${label}: Rename mailbox changes the folder name`, async () => {
    return session(
      spec,
      { messages: [], mailboxes: [{ name: 'Projects', attributes: [], messages: [note(1, 'Keep me')] }] },
      async (client) => {
        const renamed = JSON.parse(
          await callText(client, tool(spec, 'rename_mailbox'), acc(spec, { name: 'Projects', newName: 'Archive' })),
        );
        check(renamed.name === 'Projects' && renamed.newName === 'Archive', 'result');
        const listed = JSON.parse(await callText(client, tool(spec, 'list_mailboxes'), acc(spec)));
        const names = listed.map((mailbox) => mailbox.name);
        check(names.includes('Archive') && !names.includes('Projects'), names.join(','));
        const page = parseEnvelope(
          await callText(client, tool(spec, 'list_messages'), acc(spec, { mailbox: 'Archive' })),
        );
        check(page.messages.some((message) => message.subject === 'Keep me'), 'message');
        return 'Projects renamed to Archive';
      },
    );
  });

  await scenario(`${label}: Empty rename is rejected`, async () => {
    return session(
      spec,
      { messages: [], mailboxes: [{ name: 'Projects', attributes: [], messages: [] }] },
      async (client) => {
        const empty = await expectFail(
          client,
          tool(spec, 'rename_mailbox'),
          acc(spec, { name: '', newName: 'Archive' }),
        );
        check(empty.includes('Mailbox name is required'), empty);
        const blank = await expectFail(
          client,
          tool(spec, 'rename_mailbox'),
          acc(spec, { name: 'Projects', newName: '   ' }),
        );
        check(blank.includes('Mailbox name is required'), blank);
        const names = JSON.parse(await callText(client, tool(spec, 'list_mailboxes'), acc(spec))).map(
          (mailbox) => mailbox.name,
        );
        check(names.includes('Projects') && !names.includes('Archive'), names.join(','));
        return 'Mailbox name is required';
      },
    );
  });

  await scenario(`${label}: Inbox cannot be renamed`, async () => {
    return session(
      spec,
      { messages: [], mailboxes: [{ name: 'Incoming', attributes: ['\\Inbox'], messages: [] }] },
      async (client) => {
        for (const name of ['INBOX', 'inbox', 'Incoming']) {
          const message = await expectFail(
            client,
            tool(spec, 'rename_mailbox'),
            acc(spec, { name, newName: 'Elsewhere' }),
          );
          check(message.includes('Inbox cannot be renamed'), `${name}: ${message}`);
        }
        const names = JSON.parse(await callText(client, tool(spec, 'list_mailboxes'), acc(spec))).map(
          (mailbox) => mailbox.name,
        );
        check(names.includes('INBOX') && names.includes('Incoming') && !names.includes('Elsewhere'), names.join(','));
        return 'INBOX, inbox, and Incoming refused';
      },
    );
  });

  await scenario(`${label}: Delete mailbox removes the folder`, async () => {
    return session(
      spec,
      {
        messages: [],
        mailboxes: [
          { name: 'Deleted Items', attributes: ['\\Trash'], messages: [] },
          { name: 'Projects', attributes: [], messages: [note(1, 'Gone with the folder')] },
        ],
      },
      async (client) => {
        const deleted = JSON.parse(
          await callText(client, tool(spec, 'delete_mailbox'), acc(spec, { name: 'Projects' })),
        );
        check(deleted.name === 'Projects', 'name');
        const listed = JSON.parse(await callText(client, tool(spec, 'list_mailboxes'), acc(spec)));
        check(!listed.some((mailbox) => mailbox.name === 'Projects'), 'still listed');
        const trash = parseEnvelope(
          await callText(client, tool(spec, 'list_messages'), acc(spec, { mailbox: 'Deleted Items' })),
        );
        check(!trash.messages.some((message) => message.subject === 'Gone with the folder'), 'moved to trash');
        return 'Projects removed, trash unchanged';
      },
    );
  });

  await scenario(`${label}: Empty delete name is rejected`, async () => {
    return session(spec, { messages: [] }, async (client) => {
      const empty = await expectFail(client, tool(spec, 'delete_mailbox'), acc(spec, { name: '' }));
      const blank = await expectFail(client, tool(spec, 'delete_mailbox'), acc(spec, { name: '   ' }));
      check(empty.includes('Mailbox name is required') && blank.includes('Mailbox name is required'), empty);
      const names = JSON.parse(await callText(client, tool(spec, 'list_mailboxes'), acc(spec))).map(
        (mailbox) => mailbox.name,
      );
      check(names.includes('INBOX'), 'inbox');
      return 'Mailbox name is required';
    });
  });

  await scenario(`${label}: Inbox cannot be deleted`, async () => {
    return session(
      spec,
      { messages: [], mailboxes: [{ name: 'Incoming', attributes: ['\\Inbox'], messages: [] }] },
      async (client) => {
        for (const name of ['INBOX', 'inbox', 'Incoming']) {
          const message = await expectFail(client, tool(spec, 'delete_mailbox'), acc(spec, { name }));
          check(message.includes('Inbox cannot be deleted'), `${name}: ${message}`);
        }
        const names = JSON.parse(await callText(client, tool(spec, 'list_mailboxes'), acc(spec))).map(
          (mailbox) => mailbox.name,
        );
        check(names.includes('INBOX') && names.includes('Incoming'), names.join(','));
        return 'INBOX, inbox, and Incoming refused';
      },
    );
  });

  await scenario(`${label}: Server refusal leaves the mailbox`, async () => {
    return session(
      spec,
      { messages: [], mailboxes: [{ name: 'Projects', attributes: [], messages: [] }], deleteNo: FIXTURE_PASSWORD },
      async (client) => {
        const message = await expectFail(client, tool(spec, 'delete_mailbox'), acc(spec, { name: 'Projects' }));
        check(!message.includes(FIXTURE_PASSWORD), 'password');
        const names = JSON.parse(await callText(client, tool(spec, 'list_mailboxes'), acc(spec))).map(
          (mailbox) => mailbox.name,
        );
        check(names.includes('Projects'), names.join(','));
        return 'NO scrubbed, Projects remains';
      },
    );
  });

  await scenario(`${label}: Move message into an existing mailbox`, async () => {
    return session(
      spec,
      { messages: [note(7, 'Move me')], mailboxes: [{ name: 'Archive', attributes: [], messages: [] }] },
      async (client) => {
        const moved = JSON.parse(
          await callText(client, tool(spec, 'move_message'), acc(spec, { uid: 7, destination: 'Archive' })),
        );
        check(moved.uid === 7 && moved.source === 'INBOX' && moved.destination === 'Archive', JSON.stringify(moved));
        const inbox = parseEnvelope(await listText(client, spec));
        check(!uids(inbox).includes(7), 'still in inbox');
        const archive = parseEnvelope(
          await callText(client, tool(spec, 'list_messages'), acc(spec, { mailbox: 'Archive' })),
        );
        check(
          archive.messages.some(
            (message) => message.subject === 'Move me' && message.from === 'alice@example.test' && message.to === 'me@example.test',
          ),
          'archive',
        );
        return 'uid 7 moved to Archive';
      },
    );
  });

  await scenario(`${label}: Missing destination leaves the message in the source`, async () => {
    return session(spec, { messages: [note(7, 'Stay')] }, async (client) => {
      const message = await expectFail(
        client,
        tool(spec, 'move_message'),
        acc(spec, { uid: 7, destination: 'Missing' }),
      );
      check(message.includes('Destination mailbox does not exist'), message);
      const inbox = parseEnvelope(await listText(client, spec));
      check(uids(inbox).includes(7), 'left inbox');
      return message;
    });
  });

  await scenario(`${label}: Move uid below 1 is rejected`, async () => {
    return session(
      spec,
      { messages: [note(7, 'Stay')], mailboxes: [{ name: 'Archive', attributes: [], messages: [] }] },
      async (client) => {
        const message = await expectFail(
          client,
          tool(spec, 'move_message'),
          acc(spec, { uid: 0, destination: 'Archive' }),
        );
        check(message.includes('uid is required'), message);
        check(uids(parseEnvelope(await listText(client, spec))).includes(7), 'left inbox');
        return message;
      },
    );
  });

  await scenario(`${label}: Copy message keeps the source`, async () => {
    return session(
      spec,
      { messages: [note(7, 'Copy me')], mailboxes: [{ name: 'Archive', attributes: [], messages: [] }] },
      async (client) => {
        const copied = JSON.parse(
          await callText(client, tool(spec, 'copy_message'), acc(spec, { uid: 7, destination: 'Archive' })),
        );
        check(copied.uid === 7 && copied.destination === 'Archive', JSON.stringify(copied));
        check(uids(parseEnvelope(await listText(client, spec))).includes(7), 'source gone');
        const archive = parseEnvelope(
          await callText(client, tool(spec, 'list_messages'), acc(spec, { mailbox: 'Archive' })),
        );
        check(archive.messages.some((message) => message.subject === 'Copy me' && message.to === 'me@example.test'), 'copy');
        return 'source uid 7 kept, copy in Archive';
      },
    );
  });

  await scenario(`${label}: Copy missing destination does not copy`, async () => {
    return session(spec, { messages: [note(7, 'Stay')] }, async (client) => {
      const message = await expectFail(
        client,
        tool(spec, 'copy_message'),
        acc(spec, { uid: 7, destination: 'Missing' }),
      );
      check(message.includes('Destination mailbox does not exist'), message);
      check(uids(parseEnvelope(await listText(client, spec))).includes(7), 'source');
      return message;
    });
  });

  await scenario(`${label}: Copy uid below 1 is rejected`, async () => {
    return session(
      spec,
      { messages: [note(7, 'Stay')], mailboxes: [{ name: 'Archive', attributes: [], messages: [] }] },
      async (client) => {
        const message = await expectFail(
          client,
          tool(spec, 'copy_message'),
          acc(spec, { uid: 0, destination: 'Archive' }),
        );
        check(message.includes('uid is required'), message);
        check(uids(parseEnvelope(await listText(client, spec))).includes(7), 'source');
        return message;
      },
    );
  });

  await scenario(`${label}: Delete message moves it into trash`, async () => {
    return session(
      spec,
      {
        messages: [note(7, 'Delete me')],
        mailboxes: [{ name: 'Deleted Items', attributes: ['\\Trash'], messages: [] }],
      },
      async (client) => {
        const text = await callText(client, tool(spec, 'delete_message'), acc(spec, { uid: 7 }));
        check(!text.includes('[Gmail]/'), 'hard-coded folder');
        const deleted = JSON.parse(text);
        check(deleted.destination === 'Deleted Items' && deleted.source === 'INBOX', JSON.stringify(deleted));
        check(!uids(parseEnvelope(await listText(client, spec))).includes(7), 'inbox');
        const trash = parseEnvelope(
          await callText(client, tool(spec, 'list_messages'), acc(spec, { mailbox: 'Deleted Items' })),
        );
        check(trash.messages.some((message) => message.subject === 'Delete me'), 'trash');
        return 'moved to Deleted Items';
      },
    );
  });

  await scenario(`${label}: Missing trash leaves the message in place`, async () => {
    return session(spec, { messages: [note(7, 'Stay')] }, async (client) => {
      const message = await expectFail(client, tool(spec, 'delete_message'), acc(spec, { uid: 7 }));
      check(message.includes('Trash mailbox is not available'), message);
      check(uids(parseEnvelope(await listText(client, spec))).includes(7), 'inbox');
      return message;
    });
  });

  await scenario(`${label}: Delete message uid below 1 is rejected`, async () => {
    return session(
      spec,
      {
        messages: [note(7, 'Stay')],
        mailboxes: [{ name: 'Deleted Items', attributes: ['\\Trash'], messages: [] }],
      },
      async (client) => {
        const message = await expectFail(client, tool(spec, 'delete_message'), acc(spec, { uid: 0 }));
        check(message.includes('uid is required'), message);
        check(uids(parseEnvelope(await listText(client, spec))).includes(7), 'inbox');
        return message;
      },
    );
  });

  await scenario(`${label}: Restore message moves it out of trash`, async () => {
    return session(
      spec,
      {
        messages: [],
        mailboxes: [{ name: 'Deleted Items', attributes: ['\\Trash'], messages: [note(9, 'Restore me')] }],
      },
      async (client) => {
        const restored = JSON.parse(await callText(client, tool(spec, 'restore_message'), acc(spec, { uid: 9 })));
        check(restored.source === 'Deleted Items' && restored.destination === 'INBOX' && restored.uid === 9, JSON.stringify(restored));
        const inbox = parseEnvelope(await listText(client, spec));
        check(inbox.messages.some((message) => message.subject === 'Restore me'), 'inbox');
        const trash = parseEnvelope(
          await callText(client, tool(spec, 'list_messages'), acc(spec, { mailbox: 'Deleted Items' })),
        );
        check(!trash.messages.some((message) => message.subject === 'Restore me'), 'trash');
        return 'restored to INBOX';
      },
    );
  });

  await scenario(`${label}: Restore without a trash mailbox is rejected`, async () => {
    return session(spec, { messages: [note(7, 'Stay')] }, async (client) => {
      const message = await expectFail(client, tool(spec, 'restore_message'), acc(spec, { uid: 7 }));
      check(message.includes('Trash mailbox is not available'), message);
      check(uids(parseEnvelope(await listText(client, spec))).includes(7), 'inbox');
      return message;
    });
  });

  await scenario(`${label}: Restore missing destination leaves the message in trash`, async () => {
    return session(
      spec,
      {
        messages: [],
        mailboxes: [{ name: 'Deleted Items', attributes: ['\\Trash'], messages: [note(9, 'Stay deleted')] }],
      },
      async (client) => {
        const message = await expectFail(
          client,
          tool(spec, 'restore_message'),
          acc(spec, { uid: 9, destination: 'Missing' }),
        );
        check(message.includes('Destination mailbox does not exist'), message);
        const trash = parseEnvelope(
          await callText(client, tool(spec, 'list_messages'), acc(spec, { mailbox: 'Deleted Items' })),
        );
        check(trash.messages.some((entry) => entry.subject === 'Stay deleted'), 'left trash');
        return message;
      },
    );
  });

  await scenario(`${label}: Restore uid below 1 is rejected`, async () => {
    return session(
      spec,
      {
        messages: [],
        mailboxes: [{ name: 'Deleted Items', attributes: ['\\Trash'], messages: [note(9, 'Stay')] }],
      },
      async (client) => {
        const message = await expectFail(client, tool(spec, 'restore_message'), acc(spec, { uid: 0 }));
        check(message.includes('uid is required'), message);
        const trash = parseEnvelope(
          await callText(client, tool(spec, 'list_messages'), acc(spec, { mailbox: 'Deleted Items' })),
        );
        check(uids(trash).includes(9), 'left trash');
        return message;
      },
    );
  });

  await scenario(`${label}: Fixture password absent from tool result and MCP error`, async () => {
    await session(spec, { messages: sameDateMessages(3) }, async (client) => {
      const text = await callText(client, tool(spec, 'list_messages'), acc(spec, { limit: 2 }));
      check(!text.includes(FIXTURE_PASSWORD), 'success leak');
    });
    const broken = {
      ...spec.connector,
      tools: spec.connector.tools.map((entry) =>
        entry.name === 'list_messages'
          ? {
              ...entry,
              handler: () => {
                throw new Error(`provider boom ${FIXTURE_PASSWORD}`);
              },
            }
          : entry,
      ),
    };
    const egress = spec.createTransport({
      imap: { user: spec.address, password: FIXTURE_PASSWORD, messages: sameDateMessages(1) },
      smtp: { user: spec.address, password: FIXTURE_PASSWORD },
    });
    const app = createMcpApp({
      store: storeFor(spec),
      connectorRegistry: buildConnectorRegistry([broken]),
      egressTransport: egress,
    });
    const listened = await listen(app);
    try {
      await withClient(listened.baseUrl, spec.bearer, async (client) => {
        const message = await expectFail(client, tool(spec, 'list_messages'), acc(spec));
        check(!message.includes(FIXTURE_PASSWORD), message);
      });
    } finally {
      await closeServer(listened.server);
    }
    return 'list result and handler throw omit the fixture password';
  });

  await scenario(`${label}: Fixture password absent from move_message failure`, async () => {
    return session(
      spec,
      {
        messages: [note(7, 'Stay')],
        mailboxes: [{ name: 'Archive', attributes: [], messages: [] }],
        moveNo: FIXTURE_PASSWORD,
      },
      async (client) => {
        const message = await expectFail(
          client,
          tool(spec, 'move_message'),
          acc(spec, { uid: 7, destination: 'Archive' }),
        );
        check(!message.includes(FIXTURE_PASSWORD), message);
        check(uids(parseEnvelope(await listText(client, spec))).includes(7), 'moved');
        return 'NO scrubbed, message stayed';
      },
    );
  });

  await scenario(`${label}: Fixture password absent from copy_message failure`, async () => {
    return session(
      spec,
      {
        messages: [note(7, 'Copy me')],
        mailboxes: [{ name: 'Archive', attributes: [], messages: [] }],
        copyNo: FIXTURE_PASSWORD,
      },
      async (client) => {
        const message = await expectFail(
          client,
          tool(spec, 'copy_message'),
          acc(spec, { uid: 7, destination: 'Archive' }),
        );
        check(!message.includes(FIXTURE_PASSWORD), message);
        check(uids(parseEnvelope(await listText(client, spec))).includes(7), 'source');
        const archive = parseEnvelope(
          await callText(client, tool(spec, 'list_messages'), acc(spec, { mailbox: 'Archive' })),
        );
        check(!archive.messages.some((entry) => entry.subject === 'Copy me'), 'copied');
        return 'NO scrubbed, copy not created';
      },
    );
  });

  await scenario(`${label}: Fixture password absent from update_flags failure`, async () => {
    return session(spec, { messages: [note(7, 'plain')], storeNo: FIXTURE_PASSWORD }, async (client, egress) => {
      const message = await expectFail(
        client,
        tool(spec, 'update_flags'),
        acc(spec, { uid: 7, seen: true }),
      );
      check(!message.includes(FIXTURE_PASSWORD), message);
      check(JSON.stringify(egress.messageFlags('INBOX', 7)) === JSON.stringify({ seen: false, flagged: false }), 'flags');
      return 'NO scrubbed, flags unchanged';
    });
  });

  await scenario(`${label}: Fixture password absent from delete_mailbox failure`, async () => {
    return session(
      spec,
      { messages: [], mailboxes: [{ name: 'Projects', attributes: [], messages: [] }], deleteNo: FIXTURE_PASSWORD },
      async (client) => {
        const message = await expectFail(client, tool(spec, 'delete_mailbox'), acc(spec, { name: 'Projects' }));
        check(!message.includes(FIXTURE_PASSWORD), message);
        const names = JSON.parse(await callText(client, tool(spec, 'list_mailboxes'), acc(spec))).map(
          (mailbox) => mailbox.name,
        );
        check(names.includes('Projects'), 'removed');
        return 'NO scrubbed, Projects remains';
      },
    );
  });

  await scenario(`${label}: Fixture password absent from get_attachment failure`, async () => {
    return session(spec, { messages: [attachedMessage(42)], attachmentNo: FIXTURE_PASSWORD }, async (client) => {
      const message = await expectFail(
        client,
        tool(spec, 'get_attachment'),
        acc(spec, { uid: 42, index: 0 }),
      );
      check(!message.includes(FIXTURE_PASSWORD), message);
      check(!message.includes('ZmlsZS1ieXRlcw==') && !message.includes('"data"'), message);
      return 'NO scrubbed, not an attachment object';
    });
  });

  await scenario(`${label}: Foreign and disabled account do not open a session`, async () => {
    return session(spec, { messages: [note(1, 'only')] }, async (client, egress) => {
      const before = egress.tlsSessionCallCount;
      const foreign = await expectFail(client, tool(spec, 'list_messages'), { account: spec.foreignId });
      const disabled = await expectFail(client, tool(spec, 'list_messages'), { account: spec.disabledId });
      check(!foreign.includes(FIXTURE_PASSWORD) && !disabled.includes(FIXTURE_PASSWORD), 'password');
      check(egress.tlsSessionCallCount === before, `sessions ${egress.tlsSessionCallCount}`);
      return 'both rejected, tls session count unchanged';
    });
  });

  await scenario(`${label}: tools/list has mailbox tools without host or secret`, async () => {
    return session(spec, { messages: [] }, async (client) => {
      const listed = await client.listTools();
      const names = listed.tools.map((entry) => entry.name);
      const expected = [
        'list_messages',
        'search_messages',
        'list_mailboxes',
        'create_mailbox',
        'rename_mailbox',
        'delete_mailbox',
        'move_message',
        'copy_message',
        'delete_message',
        'restore_message',
        'read_message',
        'get_attachment',
        'update_flags',
      ].map((short) => tool(spec, short));
      for (const name of expected) {
        check(names.includes(name), `missing ${name}`);
      }
      const blob = JSON.stringify(listed);
      check(!blob.includes(FIXTURE_PASSWORD) && !blob.includes(spec.host), 'leak');
      for (const entry of listed.tools) {
        const keys = Object.keys(entry.inputSchema?.properties ?? {});
        for (const key of keys) {
          check(!['host', 'url', 'secret', 'password', 'command'].includes(key), `${entry.name} ${key}`);
        }
      }
      return expected.length + ' tools, no host or secret argument';
    });
  });
}

async function unauthorizedBody(baseUrl, authHeader) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (authHeader !== undefined) {
    headers.Authorization = authHeader;
  }
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e', version: '0.0.0' },
      },
    }),
  });
  return { status: response.status, text: await response.text() };
}

async function runShared() {
  const gmail = specs[0];
  const mailru = specs[1];
  const gmailEgress = gmail.createTransport({
    imap: { user: gmail.address, password: FIXTURE_PASSWORD, messages: [note(1, 'only')] },
    smtp: { user: gmail.address, password: FIXTURE_PASSWORD },
  });
  const mailruEgress = mailru.createTransport({
    imap: { user: mailru.address, password: FIXTURE_PASSWORD, messages: [note(1, 'only')] },
    smtp: { user: mailru.address, password: FIXTURE_PASSWORD },
  });
  const egress = {
    httpsRequest() {
      return Promise.reject(new Error('https not used'));
    },
    tlsConnect() {
      return Promise.reject(new Error('tlsConnect not used'));
    },
    tlsSession(params) {
      if (params.host.endsWith('gmail.com')) {
        return gmailEgress.tlsSession(params);
      }
      return mailruEgress.tlsSession(params);
    },
  };
  const bearer = 'shared-e2e-bearer-UNIQUE';
  const store = createMemoryStore({
    accounts: [
      {
        id: gmail.accountId,
        connector: 'gmail',
        label: 'Gmail',
        enabled: true,
        values: { address: gmail.address, password: FIXTURE_PASSWORD },
      },
      {
        id: mailru.accountId,
        connector: 'mailru',
        label: 'Mail.ru',
        enabled: true,
        values: { address: mailru.address, password: FIXTURE_PASSWORD },
      },
    ],
    configurations: [
      {
        id: 'shared-cfg',
        name: 'Shared',
        tokenHash: hashToken(bearer),
        enabled: true,
        accountIds: [gmail.accountId, mailru.accountId],
      },
    ],
  });
  const mcpApp = createMcpApp({
    store,
    connectorRegistry: productionConnectorRegistry,
    egressTransport: egress,
  });
  const adminApp = createAdminApp({
    store,
    connectorRegistry: productionConnectorRegistry,
    egressTransport: egress,
  });
  const mcp = await listen(mcpApp);
  const admin = await listen(adminApp);
  try {
    await scenario('MCP vs admin port separation', async () => {
      const adminMcp = await fetch(`${admin.baseUrl}/mcp`, { method: 'POST' });
      const mcpApi = await fetch(`${mcp.baseUrl}/api/connectors`);
      check(adminMcp.status === 404 && mcpApi.status === 404, `${adminMcp.status} ${mcpApi.status}`);
      return 'admin /mcp 404; MCP /api/connectors 404';
    });

    await scenario('Empty and unknown bearer identical rejection', async () => {
      const empty = await unauthorizedBody(mcp.baseUrl, undefined);
      const unknown = await unauthorizedBody(mcp.baseUrl, `Bearer ${UNKNOWN_BEARER}`);
      check(empty.status === 401 && unknown.status === 401, `${empty.status} ${unknown.status}`);
      check(empty.text === unknown.text, 'bodies differ');
      check(!empty.text.includes(FIXTURE_PASSWORD) && !empty.text.includes(bearer), empty.text);
      return 'both 401 with the same body';
    });

    await scenario('Admin API create, list, and check omit the fixture password', async () => {
      const created = await fetch(`${admin.baseUrl}/api/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connector: 'gmail',
          label: 'Created by API',
          values: { address: gmail.address, password: FIXTURE_PASSWORD },
        }),
      });
      const createdText = await created.text();
      check(created.status === 201, `${created.status} ${createdText}`);
      check(!createdText.includes(FIXTURE_PASSWORD), 'create leak');
      const createdJson = JSON.parse(createdText);
      const listed = await fetch(`${admin.baseUrl}/api/accounts`);
      const listedText = await listed.text();
      check(listed.status === 200 && !listedText.includes(FIXTURE_PASSWORD), 'list leak');
      const checked = await fetch(`${admin.baseUrl}/api/accounts/${createdJson.id}/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const checkedText = await checked.text();
      check(checked.status === 200 && !checkedText.includes(FIXTURE_PASSWORD), `${checked.status} ${checkedText}`);
      const failed = await fetch(`${admin.baseUrl}/api/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connector: 'mailru',
          label: 'Should not save',
          values: { address: mailru.address, password: `wrong-${FIXTURE_PASSWORD}` },
        }),
      });
      const failedText = await failed.text();
      check(failed.status === 400 && failedText === 'Connection check failed', failedText);
      check(!failedText.includes(FIXTURE_PASSWORD), 'failure leak');
      const after = await (await fetch(`${admin.baseUrl}/api/accounts`)).text();
      check(!after.includes('Should not save') && !after.includes(FIXTURE_PASSWORD), after);
      return '201 and list omit the password; failed create is Connection check failed';
    });
  } finally {
    await closeServer(mcp.server);
    await closeServer(admin.server);
  }
}

for (const spec of specs) {
  await runConnector(spec);
}
await runShared();

const failed = results.filter((entry) => !entry.ok);
console.log(`E2E_SUMMARY pass=${results.length - failed.length} fail=${failed.length}`);
if (failed.length > 0) {
  process.exitCode = 1;
}
