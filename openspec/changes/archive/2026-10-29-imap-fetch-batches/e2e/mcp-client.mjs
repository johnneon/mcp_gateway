/**
 * Throwaway MCP walk for imap-fetch-batches delta scenarios.
 * Fake IMAP only. Does not contact live Gmail or Mail.ru.
 * Run from the repo root:
 *   node node_modules/vite-node/vite-node.mjs openspec/changes/imap-fetch-batches/e2e/mcp-client.mjs
 */
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { gmailConnector } from '../../../../server/src/connectors/gmail/index.ts';
import { mailruConnector } from '../../../../server/src/connectors/mailru/index.ts';
import { buildConnectorRegistry } from '../../../../server/src/connectors/registry.ts';
import { createAdminApp } from '../../../../server/src/http/createAdminApp.ts';
import { createMcpApp } from '../../../../server/src/http/createMcpApp.ts';
import { hashToken } from '../../../../server/src/token/token.ts';
import { createGmailFakeEgressTransport } from '../../../../server/test/connectors/gmail/fake-egress.ts';
import { createMailruFakeEgressTransport } from '../../../../server/test/connectors/mailru/fake-egress.ts';

const BUDGET = 4096;

function utf8Bytes(value) {
  return Buffer.byteLength(value, 'utf8');
}

function largeInbox() {
  const messages = [];
  for (let uid = 1; uid <= 1100; uid += 1) {
    let date = '01 Jan 2024 00:00:00 +0000';
    if (uid === 1100) {
      date = '02 Feb 2024 00:00:00 +0000';
    } else if (uid === 1099) {
      date = '01 Feb 2024 00:00:00 +0000';
    }
    messages.push({
      uid,
      from: 'alice@example.test',
      to: 'me@example.test',
      subject: `Subject ${String(uid)}`,
      date,
      seen: false,
      textBody: `large-body-${String(uid)}`,
    });
  }
  return messages;
}

function filteredAliceBobInbox() {
  const messages = [];
  for (let i = 0; i <= 399; i += 1) {
    const aliceUid = 1000000001 + 2 * i;
    const bobUid = 1000000002 + 2 * i;
    let aliceDate = '01 Jan 2024 00:00:00 +0000';
    if (aliceUid === 1000000799) {
      aliceDate = '02 Feb 2024 00:00:00 +0000';
    } else if (aliceUid === 1000000797) {
      aliceDate = '01 Feb 2024 00:00:00 +0000';
    }
    messages.push({
      uid: aliceUid,
      from: 'alice@example.test',
      to: 'me@example.test',
      subject: `Alice ${String(i)}`,
      date: aliceDate,
      seen: false,
      textBody: `alice-body-${String(aliceUid)}`,
    });
    messages.push({
      uid: bobUid,
      from: 'bob@example.test',
      to: 'me@example.test',
      subject: `Neighbor ${String(i)}`,
      date: '01 Jan 2024 00:00:00 +0000',
      seen: false,
      textBody: `bob-body-${String(bobUid)}`,
    });
  }
  return messages;
}

function newestLargeUids() {
  const uids = [1100, 1099];
  for (let uid = 1098; uid >= 1; uid -= 1) {
    uids.push(uid);
  }
  return uids;
}

function aliceUidsInSearchOrder() {
  const uids = [];
  for (let i = 0; i <= 399; i += 1) {
    uids.push(1000000001 + 2 * i);
  }
  return uids;
}

function newestAliceUids() {
  const uids = [1000000799, 1000000797];
  for (let uid = 1000000795; uid >= 1000000001; uid -= 2) {
    uids.push(uid);
  }
  return uids;
}
const results = [];
const hostsSeen = new Set();

const specs = [
  {
    id: 'gmail',
    prefix: 'gmail',
    address: 'user@gmail.com',
    password: 'gmail-tool-fixture-password-UNIQUE',
    bearer: 'gmail-e2e-bearer-UNIQUE',
    unknownBearer: 'gmail-unknown-bearer-UNIQUE',
    accountId: 'gmail-e2e-acc',
    foreignId: 'gmail-e2e-foreign',
    disabledId: 'gmail-e2e-disabled',
    connector: gmailConnector,
    createTransport: createGmailFakeEgressTransport,
    hosts: new Set(['imap.gmail.com:993', 'smtp.gmail.com:465']),
  },
  {
    id: 'mailru',
    prefix: 'mailru',
    address: 'user@mail.ru',
    password: 'mailru-tool-fixture-password-UNIQUE',
    bearer: 'mailru-e2e-bearer-UNIQUE',
    unknownBearer: 'mailru-unknown-bearer-UNIQUE',
    accountId: 'mailru-e2e-acc',
    foreignId: 'mailru-e2e-foreign',
    disabledId: 'mailru-e2e-disabled',
    connector: mailruConnector,
    createTransport: createMailruFakeEgressTransport,
    hosts: new Set(['imap.mail.ru:993', 'smtp.mail.ru:465']),
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
  const messages = [note(1, 'Subject 1', '01 Feb 2024 00:00:00 +0000', { seen: true })];
  for (let uid = 2; uid <= 21; uid += 1) {
    const day = String(uid - 1).padStart(2, '0');
    messages.push(note(uid, `Subject ${String(uid)}`, `${day} Jan 2024 00:00:00 +0000`));
  }
  return messages;
}

function sameDateMessages(count) {
  const messages = [];
  for (let uid = 1; uid <= count; uid += 1) {
    messages.push(note(uid, `Subject ${String(uid)}`));
  }
  return messages;
}

function manyMessages(count) {
  const messages = [];
  for (let i = 1; i <= count; i += 1) {
    messages.push(
      note(i, `Subject ${String(i)}`, 'Mon, 1 Jan 2024 00:00:00 +0000', {
        from: i % 2 === 0 ? 'alice@example.test' : 'bob@example.test',
        seen: i % 3 === 0,
        textBody: `Body ${String(i)}`,
      }),
    );
  }
  return messages;
}

function toolText(result) {
  const record = result;
  return record.content?.map((part) => part.text ?? '').join('\n') ?? JSON.stringify(result);
}

function parseEnvelope(text) {
  const parsed = JSON.parse(text);
  check(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed), 'envelope is not an object');
  check(Array.isArray(parsed.messages), 'messages is not an array');
  return parsed;
}

function messageUids(envelope) {
  return envelope.messages.map((message) => message.uid);
}

function assertSummaryShape(message) {
  for (const key of ['uid', 'from', 'to', 'subject', 'date', 'seen', 'unread']) {
    check(Object.hasOwn(message, key), `missing ${key}`);
  }
  check(!Object.hasOwn(message, 'textBody'), 'textBody present');
  check(!Object.hasOwn(message, 'htmlBody'), 'htmlBody present');
  check(!Object.hasOwn(message, 'body'), 'body present');
}

function assertNoPassword(text, password) {
  check(!text.includes(password), 'fixture password present');
}

function uidFetches(commands) {
  return commands.filter((command) => command.toUpperCase().startsWith('UID FETCH '));
}

function assertUidFetches(commands, expectedUids, mode) {
  const fetches = uidFetches(commands);
  if (mode === 'one') {
    check(fetches.length === 1, `expected one UID FETCH, saw ${String(fetches.length)}`);
  } else {
    check(fetches.length > 1, `expected more than one UID FETCH, saw ${String(fetches.length)}`);
  }
  const named = [];
  for (const command of fetches) {
    check(utf8Bytes(command) <= BUDGET, `UID FETCH is ${String(utf8Bytes(command))} bytes`);
    check(!command.includes('1:*'), 'UID FETCH uses 1:*');
    check(!/\d+:/.test(command), 'UID FETCH uses a range');
    const match = /^UID FETCH\s+(\S+)\s+/i.exec(command);
    check(match?.[1] !== undefined, 'UID FETCH has no set');
    const set = match[1];
    check(!set.includes(':') && !set.includes('*'), `UID set is ${set}`);
    for (const part of set.split(',')) {
      check(/^\d+$/.test(part), `UID part ${part}`);
      named.push(Number(part));
    }
  }
  check(named.length === expectedUids.length, `named ${String(named.length)} uids, expected ${String(expectedUids.length)}`);
  for (let index = 0; index < expectedUids.length; index += 1) {
    check(named[index] === expectedUids[index], `uid ${String(named[index])} at ${String(index)}, expected ${String(expectedUids[index])}`);
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(address.port);
    });
    server.once('error', reject);
  });
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

async function withMcp(spec, messages, extra, run) {
  const egress = spec.createTransport({
    imap: {
      user: spec.address,
      password: spec.password,
      messages,
      maxUidFetchCommandBytes: BUDGET,
      ...extra,
    },
    smtp: { user: spec.address, password: spec.password },
  });
  const inner = egress.tlsSession.bind(egress);
  egress.tlsSession = (params) => {
    const target = `${params.host}:${String(params.port)}`;
    hostsSeen.add(target);
    check(spec.hosts.has(target), `unexpected host ${target}`);
    return inner(params);
  };
  const store = createMemoryStore({
    accounts: [
      {
        id: spec.accountId,
        connector: spec.id,
        label: 'Inbox',
        enabled: true,
        values: { address: spec.address, password: spec.password },
      },
      {
        id: spec.foreignId,
        connector: spec.id,
        label: 'Foreign',
        enabled: true,
        values: { address: spec.address, password: spec.password },
      },
      {
        id: spec.disabledId,
        connector: spec.id,
        label: 'Disabled',
        enabled: false,
        values: { address: spec.address, password: spec.password },
      },
    ],
    configurations: [
      {
        id: `${spec.id}-cfg`,
        name: `${spec.id} e2e`,
        tokenHash: hashToken(spec.bearer),
        enabled: true,
        accountIds: [spec.accountId, spec.disabledId],
      },
    ],
  });
  const registry = buildConnectorRegistry([spec.connector]);
  const mcpApp = createMcpApp({ store, connectorRegistry: registry, egressTransport: egress });
  const adminApp = createAdminApp({ store, connectorRegistry: registry, egressTransport: egress });
  const mcpServer = http.createServer(mcpApp);
  const adminServer = http.createServer(adminApp);
  const mcpPort = await listen(mcpServer);
  const adminPort = await listen(adminServer);
  const baseUrl = `http://127.0.0.1:${String(mcpPort)}`;
  const adminUrl = `http://127.0.0.1:${String(adminPort)}`;
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${spec.bearer}` } },
  });
  const client = new Client({ name: 'imap-fetch-batches-e2e', version: '0.0.0' });
  await client.connect(transport);
  try {
    return await run({ client, egress, baseUrl, adminUrl, spec });
  } finally {
    await client.close();
    await transport.close();
    await closeServer(mcpServer);
    await closeServer(adminServer);
  }
}

async function callText(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  return toolText(result);
}

async function callError(client, name, args) {
  try {
    await client.callTool({ name, arguments: args });
  } catch (error) {
    return errorMessage(error);
  }
  throw new Error('expected the tool call to fail');
}

function searchOrder(messages) {
  return messages.map((message) => message.uid);
}

async function walkListAndSearch(spec) {
  const list = `${spec.prefix}_list_messages`;
  const search = `${spec.prefix}_search_messages`;
  const mailboxes = `${spec.prefix}_list_mailboxes`;

  await scenario(`${spec.prefix}: Default call returns the full newest set inside an envelope`, async () => {
    const messages = defaultNewestInbox();
    return await withMcp(spec, messages, {}, async ({ client, egress }) => {
      const text = await callText(client, list, { account: spec.accountId });
      assertNoPassword(text, spec.password);
      const parsed = JSON.parse(text);
      check(!Array.isArray(parsed), 'result is an array');
      const envelope = parseEnvelope(text);
      check(envelope.offset === 0 && envelope.limit === null && envelope.total === 21, 'envelope counts');
      check(envelope.messages.length === 21, 'message count');
      check(envelope.messages[0].uid === 1, 'first uid');
      check(envelope.messages[0].to === 'me@example.test', 'to');
      check(envelope.messages[0].seen === true && envelope.messages[0].unread === false, 'seen');
      const last = envelope.messages[20];
      check(last.uid === 2 && last.seen === false && last.unread === true, 'last message');
      for (const message of envelope.messages) {
        assertSummaryShape(message);
      }
      assertUidFetches(egress.commands, searchOrder(messages), 'one');
      return '21 summaries, one UID FETCH within 4096 bytes, password absent';
    });
  });

  await scenario(`${spec.prefix}: Offset and both orders page a mailbox`, async () => {
    const messages = [
      note(5, 'five', '04 Jan 2024 00:00:00 +0000'),
      note(6, 'six', '01 Jan 2024 00:00:00 +0000'),
      note(7, 'seven', '03 Jan 2024 00:00:00 +0000'),
      note(8, 'eight', '02 Jan 2024 00:00:00 +0000'),
    ];
    return await withMcp(spec, messages, {}, async ({ client }) => {
      const newest = parseEnvelope(
        await callText(client, list, { account: spec.accountId, limit: 2, offset: 0, order: 'newest' }),
      );
      check(newest.total === 4 && newest.offset === 0 && newest.limit === 2, 'newest page envelope');
      check(JSON.stringify(messageUids(newest)) === JSON.stringify([5, 7]), 'newest first page');
      const newestRest = parseEnvelope(
        await callText(client, list, { account: spec.accountId, limit: 2, offset: 2, order: 'newest' }),
      );
      check(JSON.stringify(messageUids(newestRest)) === JSON.stringify([8, 6]) && newestRest.total === 4, 'newest second page');
      const oldest = parseEnvelope(
        await callText(client, list, { account: spec.accountId, limit: 2, offset: 0, order: 'oldest' }),
      );
      check(JSON.stringify(messageUids(oldest)) === JSON.stringify([6, 8]), 'oldest first page');
      const oldestRestText = await callText(client, list, {
        account: spec.accountId,
        limit: 2,
        offset: 2,
        order: 'oldest',
      });
      assertNoPassword(oldestRestText, spec.password);
      const oldestRest = parseEnvelope(oldestRestText);
      check(JSON.stringify(messageUids(oldestRest)) === JSON.stringify([7, 5]), 'oldest second page');
      for (const message of oldestRest.messages) {
        check(typeof message.to === 'string', 'to missing');
        assertSummaryShape(message);
      }
      return 'pages 5,7 then 8,6 and 6,8 then 7,5';
    });
  });

  await scenario(`${spec.prefix}: List returns capped summaries without bodies on a fake IMAP server`, async () => {
    return await withMcp(spec, sameDateMessages(60), {}, async ({ client }) => {
      const text = await callText(client, list, { account: spec.accountId, limit: 80 });
      assertNoPassword(text, spec.password);
      check(!text.includes('body Subject'), 'body text present');
      const envelope = parseEnvelope(text);
      check(envelope.limit === 80 && envelope.offset === 0 && envelope.total === 60, 'capped envelope');
      check(envelope.messages.length === 60, 'length');
      check(envelope.messages[0].uid === 60 && envelope.messages[59].uid === 1, 'uid order');
      for (const message of envelope.messages) {
        assertSummaryShape(message);
      }
      return 'limit 80 returned 60 summaries, uid 60 down to 1';
    });
  });

  await scenario(`${spec.prefix}: Provided limit is honored with no maximum`, async () => {
    return await withMcp(spec, sameDateMessages(60), {}, async ({ client }) => {
      const text = await callText(client, list, {
        account: spec.accountId,
        limit: 2,
        offset: 0,
        order: 'oldest',
      });
      assertNoPassword(text, spec.password);
      const envelope = parseEnvelope(text);
      check(envelope.limit === 2 && envelope.offset === 0 && envelope.total === 60, 'limit envelope');
      check(JSON.stringify(messageUids(envelope)) === JSON.stringify([1, 2]), 'oldest uids');
      for (const message of envelope.messages) {
        assertSummaryShape(message);
      }
      return 'oldest limit 2 returned uids 1 then 2';
    });
  });

  await scenario(`${spec.prefix}: Unparseable dates sort as oldest`, async () => {
    const messages = [
      note(1, 'bad-1', 'not-a-date'),
      note(2, 'good', '02 Jan 2024 00:00:00 +0000'),
      note(3, 'bad-3', 'not-a-date'),
    ];
    return await withMcp(spec, messages, {}, async ({ client }) => {
      const newest = parseEnvelope(await callText(client, list, { account: spec.accountId, order: 'newest' }));
      check(newest.limit === null && newest.total === 3, 'newest envelope');
      check(JSON.stringify(messageUids(newest)) === JSON.stringify([2, 3, 1]), 'newest order');
      const oldest = parseEnvelope(await callText(client, list, { account: spec.accountId, order: 'oldest' }));
      check(JSON.stringify(messageUids(oldest)) === JSON.stringify([1, 3, 2]), 'oldest order');
      return 'newest 2, 3, 1; oldest 1, 3, 2';
    });
  });

  await scenario(`${spec.prefix}: Invalid offset and limit return the full remainder`, async () => {
    return await withMcp(spec, [note(1, 'only')], {}, async ({ client }) => {
      const first = parseEnvelope(await callText(client, list, { account: spec.accountId, limit: 0, offset: -1 }));
      check(first.offset === 0 && first.limit === null && first.total === 1 && first.messages.length === 1, 'zero limit');
      const second = parseEnvelope(
        await callText(client, list, { account: spec.accountId, limit: 1.5, offset: -4 }),
      );
      check(second.offset === 0 && second.limit === null && second.total === 1 && second.messages.length === 1, 'fractional limit');
      return 'both calls applied offset 0 and limit null';
    });
  });

  await scenario(`${spec.prefix}: Offset past the end returns an empty page`, async () => {
    return await withMcp(spec, [note(1, 'only')], {}, async ({ client }) => {
      const limited = parseEnvelope(
        await callText(client, list, { account: spec.accountId, offset: 5, limit: 20 }),
      );
      check(limited.offset === 5 && limited.limit === 20 && limited.total === 1 && limited.messages.length === 0, 'limited');
      const open = parseEnvelope(await callText(client, list, { account: spec.accountId, offset: 5 }));
      check(open.offset === 5 && open.limit === null && open.total === 1 && open.messages.length === 0, 'open');
      return 'both calls returned an empty messages array and total 1';
    });
  });

  await scenario(`${spec.prefix}: Unknown order is rejected`, async () => {
    return await withMcp(spec, [note(1, 'only')], {}, async ({ client, egress }) => {
      const before = egress.tlsSessionCallCount;
      const message = await callError(client, list, { account: spec.accountId, order: 'random' });
      assertNoPassword(message, spec.password);
      check(message.includes('Invalid order'), message);
      check(egress.searchCommandCount === 0, 'SEARCH was issued');
      check(egress.tlsSessionCallCount === before, 'TLS session opened');
      return 'Invalid order; SEARCH count stayed 0';
    });
  });

  await scenario(`${spec.prefix}: Sent, Drafts, Spam, and Trash are listed by server mailbox name`, async () => {
    return await withMcp(
      spec,
      [note(1, 'Inbox note')],
      {
        mailboxes: [
          { name: 'Sent Items', attributes: ['\\Sent'], messages: [note(1, 'Sent note')] },
          { name: 'Drafts', attributes: ['\\Drafts'], messages: [note(1, 'Draft note')] },
          { name: 'Spam', attributes: ['\\Junk'], messages: [note(1, 'Spam note')] },
          { name: 'Deleted Items', attributes: ['\\Trash'], messages: [note(1, 'Trash note')] },
        ],
      },
      async ({ client }) => {
        const listedText = await callText(client, mailboxes, { account: spec.accountId });
        assertNoPassword(listedText, spec.password);
        check(!listedText.includes('[Gmail]/'), 'gmail path present');
        const listed = JSON.parse(listedText);
        check(Array.isArray(listed), 'mailbox list is not an array');
        const byRole = (role) => {
          const match = listed.find((mailbox) => mailbox.specialUse === role);
          check(match !== undefined, `missing ${role}`);
          return String(match.name);
        };
        check(byRole('sent') === 'Sent Items', 'sent name');
        const sentText = await callText(client, list, { account: spec.accountId, mailbox: byRole('sent') });
        check(sentText.includes('Sent note') && !sentText.includes('Inbox note'), 'sent subjects');
        check(!sentText.includes('[Gmail]/'), 'sent gmail path');
        for (const message of parseEnvelope(sentText).messages) {
          assertSummaryShape(message);
        }
        const draftsText = await callText(client, list, { account: spec.accountId, mailbox: byRole('drafts') });
        check(draftsText.includes('Draft note'), 'drafts');
        const junkText = await callText(client, list, { account: spec.accountId, mailbox: byRole('junk') });
        check(junkText.includes('Spam note'), 'junk');
        const trashText = await callText(client, list, { account: spec.accountId, mailbox: byRole('trash') });
        assertNoPassword(trashText, spec.password);
        check(trashText.includes('Trash note') && !trashText.includes('[Gmail]/'), 'trash');
        return 'Sent Items, Drafts, Spam, Deleted Items; no [Gmail]/';
      },
    );
  });

  await scenario(`${spec.prefix}: Large mailbox summary fetch stays within the command budget`, async () => {
    const messages = largeInbox();
    const order = searchOrder(messages);
    check(utf8Bytes(order.join(',')) > BUDGET, 'fixture list is not over the budget');
    return await withMcp(spec, messages, {}, async ({ client, egress }) => {
      const text = await callText(client, list, { account: spec.accountId, order: 'newest' });
      assertNoPassword(text, spec.password);
      check(!text.includes('large-body-'), 'body present');
      const envelope = parseEnvelope(text);
      check(envelope.offset === 0 && envelope.limit === null && envelope.total === 1100, 'full envelope');
      check(envelope.messages.length === 1100, 'length');
      check(JSON.stringify(messageUids(envelope)) === JSON.stringify(newestLargeUids()), 'newest order');
      for (const message of envelope.messages) {
        assertSummaryShape(message);
        check(message.to === 'me@example.test', 'to');
      }
      assertUidFetches(egress.commands, order, 'many');
      const before = egress.commands.length;
      const pageText = await callText(client, list, {
        account: spec.accountId,
        limit: 2,
        offset: 0,
        order: 'newest',
      });
      assertNoPassword(pageText, spec.password);
      check(!pageText.includes('large-body-'), 'page body present');
      const page = parseEnvelope(pageText);
      check(page.total === 1100 && page.offset === 0 && page.limit === 2, 'page envelope');
      check(JSON.stringify(messageUids(page)) === JSON.stringify([1100, 1099]), 'page uids');
      for (const message of page.messages) {
        assertSummaryShape(message);
      }
      assertUidFetches(egress.commands.slice(before), order, 'many');
      return `total 1100, page 1100 then 1099, ${String(uidFetches(egress.commands).length)} UID FETCH commands within ${String(BUDGET)} bytes`;
    });
  });

  await scenario(`${spec.prefix}: Narrow filter search returns matching summaries on a fake IMAP server`, async () => {
    return await withMcp(spec, manyMessages(6), {}, async ({ client }) => {
      const text = await callText(client, search, {
        account: spec.accountId,
        filter: { from: 'alice@example.test' },
      });
      assertNoPassword(text, spec.password);
      const envelope = parseEnvelope(text);
      check(envelope.offset === 0 && envelope.limit === null, 'search envelope');
      check(envelope.messages.length > 0, 'no matches');
      check(envelope.total === envelope.messages.length, 'total');
      for (const message of envelope.messages) {
        check(String(message.from).includes('alice@example.test'), 'non-alice');
        assertSummaryShape(message);
      }
      return `filter from alice returned ${String(envelope.total)} summaries, limit null`;
    });
  });

  await scenario(`${spec.prefix}: Search applies paging and order after the filter`, async () => {
    const messages = [
      note(1, 'alice-3', '03 Jan 2024 00:00:00 +0000'),
      note(2, 'bob', '04 Jan 2024 00:00:00 +0000', { from: 'bob@example.test' }),
      note(3, 'alice-1', '01 Jan 2024 00:00:00 +0000'),
      note(4, 'alice-2', '02 Jan 2024 00:00:00 +0000'),
    ];
    return await withMcp(spec, messages, {}, async ({ client }) => {
      const oldestText = await callText(client, search, {
        account: spec.accountId,
        filter: { from: 'alice@example.test' },
        order: 'oldest',
        limit: 2,
        offset: 0,
      });
      check(!oldestText.includes('bob@example.test'), 'bob on oldest page');
      const oldest = parseEnvelope(oldestText);
      check(oldest.total === 3 && oldest.offset === 0 && oldest.limit === 2, 'oldest envelope');
      check(JSON.stringify(messageUids(oldest)) === JSON.stringify([3, 4]), 'oldest uids');
      const newestText = await callText(client, search, {
        account: spec.accountId,
        filter: { from: 'alice@example.test' },
        order: 'newest',
        limit: 2,
        offset: 2,
      });
      assertNoPassword(newestText, spec.password);
      const newest = parseEnvelope(newestText);
      check(newest.total === 3 && JSON.stringify(messageUids(newest)) === JSON.stringify([3]), 'newest remainder');
      for (const message of newest.messages) {
        assertSummaryShape(message);
      }
      return 'oldest page uids 3 then 4; newest remainder uid 3';
    });
  });

  await scenario(`${spec.prefix}: Unknown search order is rejected`, async () => {
    return await withMcp(spec, [note(1, 'only')], {}, async ({ client, egress }) => {
      const before = egress.tlsSessionCallCount;
      const message = await callError(client, search, {
        account: spec.accountId,
        order: 'random',
        filter: { from: 'alice@example.test' },
      });
      assertNoPassword(message, spec.password);
      check(message.includes('Invalid order'), message);
      check(egress.searchCommandCount === 0, 'SEARCH was issued');
      check(egress.tlsSessionCallCount === before, 'TLS session opened');
      return 'Invalid order; SEARCH count stayed 0';
    });
  });

  await scenario(`${spec.prefix}: Free-form IMAP search syntax is rejected`, async () => {
    return await withMcp(spec, manyMessages(2), {}, async ({ client, egress }) => {
      const before = egress.tlsSessionCallCount;
      const stringError = await callError(client, search, {
        account: spec.accountId,
        filter: 'OR FROM alice SUBJECT secret',
      });
      assertNoPassword(stringError, spec.password);
      check(egress.tlsSessionCallCount === before, 'string filter opened TLS');
      check(egress.searchCommandCount === 0, 'string filter issued SEARCH');
      const rawError = await callError(client, search, {
        account: spec.accountId,
        filter: { raw: 'BEFORE 1-Jan-2020' },
      });
      assertNoPassword(rawError, spec.password);
      check(egress.tlsSessionCallCount === before, 'raw filter opened TLS');
      check(egress.searchCommandCount === 0, 'raw filter issued SEARCH');
      return 'string filter and filter key raw failed; no SEARCH';
    });
  });

  await scenario(`${spec.prefix}: Filtered summary fetch stays within the command budget`, async () => {
    const alice = aliceUidsInSearchOrder();
    check(utf8Bytes(alice.join(',')) > BUDGET, 'alice list is not over the budget');
    return await withMcp(spec, filteredAliceBobInbox(), {}, async ({ client, egress }) => {
      const text = await callText(client, search, {
        account: spec.accountId,
        filter: { from: 'alice@example.test' },
        order: 'newest',
      });
      assertNoPassword(text, spec.password);
      check(!text.includes('alice-body-') && !text.includes('bob-body-'), 'body present');
      check(!text.includes('bob@example.test'), 'bob present');
      const envelope = parseEnvelope(text);
      check(envelope.offset === 0 && envelope.limit === null && envelope.total === 400, 'full envelope');
      check(envelope.messages.length === 400, 'length');
      check(JSON.stringify(messageUids(envelope)) === JSON.stringify(newestAliceUids()), 'newest alice order');
      for (const message of envelope.messages) {
        check(message.from === 'alice@example.test', 'from');
        assertSummaryShape(message);
      }
      assertUidFetches(egress.commands, alice, 'many');
      const before = egress.commands.length;
      const pageText = await callText(client, search, {
        account: spec.accountId,
        filter: { from: 'alice@example.test' },
        limit: 2,
        offset: 0,
        order: 'newest',
      });
      assertNoPassword(pageText, spec.password);
      check(!pageText.includes('bob@example.test') && !pageText.includes('alice-body-'), 'page leak');
      const page = parseEnvelope(pageText);
      check(page.total === 400 && page.offset === 0 && page.limit === 2, 'page envelope');
      check(JSON.stringify(messageUids(page)) === JSON.stringify([1000000799, 1000000797]), 'page uids');
      for (const message of page.messages) {
        check(message.from !== 'bob@example.test', 'bob on page');
        assertSummaryShape(message);
      }
      assertUidFetches(egress.commands.slice(before), alice, 'many');
      return 'total 400 alice uids, page 1000000799 then 1000000797, batches name no bob uid';
    });
  });

  await scenario(`${spec.prefix}: Foreign and disabled account`, async () => {
    return await withMcp(spec, [note(1, 'only')], {}, async ({ client, egress }) => {
      const before = egress.tlsSessionCallCount;
      const foreign = await callError(client, list, { account: spec.foreignId });
      const disabled = await callError(client, list, { account: spec.disabledId });
      assertNoPassword(foreign, spec.password);
      assertNoPassword(disabled, spec.password);
      check(foreign.includes('Invalid tool arguments'), foreign);
      check(disabled.includes('Invalid tool arguments'), disabled);
      check(egress.searchCommandCount === 0, 'SEARCH was issued');
      check(egress.tlsSessionCallCount === before, `TLS sessions changed from ${String(before)} to ${String(egress.tlsSessionCallCount)}`);
      return 'both rejected with Invalid tool arguments; fake TLS session count stayed 0';
    });
  });

  await scenario(`${spec.prefix}: tools/list has no host, URL, or secret argument`, async () => {
    return await withMcp(spec, [note(1, 'only')], {}, async ({ client }) => {
      const listed = await client.listTools();
      const text = JSON.stringify(listed);
      assertNoPassword(text, spec.password);
      const names = listed.tools.map((tool) => tool.name);
      check(names.includes(list) && names.includes(search), names.join(','));
      for (const toolName of [list, search]) {
        const tool = listed.tools.find((entry) => entry.name === toolName);
        const properties = Object.keys(tool.inputSchema.properties ?? {});
        for (const banned of ['host', 'url', 'password', 'secret', 'command']) {
          check(!properties.includes(banned), `${toolName} has ${banned}`);
        }
      }
      return `${list} and ${search} listed without host, URL, secret, or command`;
    });
  });

  await scenario(`${spec.prefix}: Empty and unknown bearer identical rejection`, async () => {
    return await withMcp(spec, [note(1, 'only')], {}, async ({ baseUrl }) => {
      const empty = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });
      const unknown = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${spec.unknownBearer}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });
      const emptyBody = await empty.text();
      const unknownBody = await unknown.text();
      assertNoPassword(emptyBody, spec.password);
      assertNoPassword(unknownBody, spec.password);
      check(empty.status === 401 && unknown.status === 401, `${String(empty.status)} vs ${String(unknown.status)}`);
      check(emptyBody === unknownBody, `bodies differ: ${emptyBody} / ${unknownBody}`);
      return `both 401 with the same body`;
    });
  });

  await scenario(`${spec.prefix}: MCP vs admin port separation`, async () => {
    return await withMcp(spec, [note(1, 'only')], {}, async ({ baseUrl, adminUrl }) => {
      const adminOnMcp = await fetch(`${baseUrl}/api/connectors`);
      const mcpOnAdmin = await fetch(`${adminUrl}/mcp`, { method: 'POST' });
      const health = await fetch(`${baseUrl}/health`);
      const adminBody = await adminOnMcp.text();
      const mcpBody = await mcpOnAdmin.text();
      const healthBody = await health.text();
      assertNoPassword(adminBody + mcpBody + healthBody, spec.password);
      check(adminOnMcp.status === 404, `mcp port admin status ${String(adminOnMcp.status)}`);
      check(mcpOnAdmin.status === 404, `admin port mcp status ${String(mcpOnAdmin.status)}`);
      check(health.status === 200 && healthBody.includes('"status":"ok"'), healthBody);
      check(!healthBody.includes(spec.password), 'health leaked password');
      return 'admin /mcp 404; MCP /api/connectors 404; /health ok';
    });
  });
}

for (const spec of specs) {
  await walkListAndSearch(spec);
}

const failed = results.filter((entry) => !entry.ok);
console.log(`HOSTS ${[...hostsSeen].sort().join(', ')}`);
console.log(`SUMMARY pass ${String(results.length - failed.length)} fail ${String(failed.length)}`);
if (failed.length > 0) {
  process.exitCode = 1;
}
