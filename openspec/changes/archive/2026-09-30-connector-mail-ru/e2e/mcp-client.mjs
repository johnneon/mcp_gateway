/**
 * Throwaway MCP and admin API walk for connector-mail-ru.
 * Uses the change's fake IMAP/SMTP egress. Does not contact live Mail.ru.
 * Run from the repo root:
 *   node node_modules/vite-node/vite-node.mjs openspec/changes/connector-mail-ru/e2e/mcp-client.mjs
 */
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mailruConnector } from '../../../../server/src/connectors/mailru/index.js';
import { buildConnectorRegistry, productionConnectorRegistry, } from '../../../../server/src/connectors/registry.js';
import { createAdminApp } from '../../../../server/src/http/createAdminApp.js';
import { createMcpApp } from '../../../../server/src/http/createMcpApp.js';
import { hashToken } from '../../../../server/src/token/token.js';
import { createMailruFakeEgressTransport } from '../../../../server/test/connectors/mailru/fake-egress.js';
const FIXTURE_PASSWORD = 'mailru-e2e-fixture-app-password-UNIQUE';
const FIXTURE_ADDRESS = 'user@mail.ru';
const BEARER = 'mailru-e2e-bearer-UNIQUE';
const UNKNOWN_BEARER = 'unknown-bearer-UNIQUE';
const ACCOUNT_ID = 'mailru-e2e-acc-1';
const FOREIGN_ID = 'mailru-e2e-foreign';
const DISABLED_ID = 'mailru-e2e-disabled';
const ATTACHMENT_BYTES = 'ATTACHMENT-BYTES-MUST-NOT-LEAK';
const results = [];
function pass(name, detail) {
    results.push({ name, ok: true, detail });
    console.log(`PASS ${name} — ${detail}`);
}
function fail(name, detail) {
    results.push({ name, ok: false, detail });
    console.error(`FAIL ${name} — ${detail}`);
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
function manyMessages(count) {
    const messages = [];
    for (let i = 1; i <= count; i += 1) {
        if (i === 42) {
            messages.push({
                uid: 42,
                from: 'alice@example.test',
                to: FIXTURE_ADDRESS,
                subject: 'With attachment',
                date: 'Mon, 1 Jan 2024 00:00:00 +0000',
                seen: true,
                textBody: 'Readable text body',
                attachmentName: 'file.bin',
                attachmentBytes: ATTACHMENT_BYTES,
            });
            continue;
        }
        messages.push({
            uid: i,
            from: i % 2 === 0 ? 'alice@example.test' : 'bob@example.test',
            to: FIXTURE_ADDRESS,
            subject: `Subject ${String(i)}`,
            date: 'Mon, 1 Jan 2024 00:00:00 +0000',
            seen: i % 3 === 0,
            textBody: `Body ${String(i)}`,
        });
    }
    return messages;
}
function mailruStore() {
    return createMemoryStore({
        accounts: [
            {
                id: ACCOUNT_ID,
                connector: 'mailru',
                label: 'Personal',
                enabled: true,
                values: { address: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD },
            },
            {
                id: FOREIGN_ID,
                connector: 'mailru',
                label: 'Foreign',
                enabled: true,
                values: { address: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD },
            },
            {
                id: DISABLED_ID,
                connector: 'mailru',
                label: 'Disabled',
                enabled: false,
                values: { address: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD },
            },
        ],
        configurations: [
            {
                id: 'cfg-1',
                name: 'Mail.ru Config',
                tokenHash: hashToken(BEARER),
                enabled: true,
                accountIds: [ACCOUNT_ID, DISABLED_ID],
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
async function withClient(baseUrl, token, run) {
    const headers = {};
    if (token !== undefined) {
        headers.Authorization = `Bearer ${token}`;
    }
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        requestInit: { headers },
    });
    const client = new Client({ name: 'e2e-connector-mail-ru', version: '0.0.0' });
    await client.connect(transport);
    try {
        return await run(client);
    }
    finally {
        await client.close();
    }
}
function toolText(result) {
    const record = result;
    return record.content?.map((part) => part.text ?? '').join('\n') ?? JSON.stringify(result);
}
function errorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
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
const messages = manyMessages(60);
const egressTransport = createMailruFakeEgressTransport({
    imap: {
        user: FIXTURE_ADDRESS,
        password: FIXTURE_PASSWORD,
        messages,
    },
    smtp: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD },
});
const store = mailruStore();
const registry = productionConnectorRegistry;
const mcpApp = createMcpApp({ store, connectorRegistry: registry, egressTransport });
const adminApp = createAdminApp({ store, connectorRegistry: registry, egressTransport });
const mcp = await listen(mcpApp);
const admin = await listen(adminApp);
try {
    {
        const adminMcp = await fetch(`${admin.baseUrl}/mcp`, { method: 'POST' });
        const mcpApi = await fetch(`${mcp.baseUrl}/api/connectors`);
        if (adminMcp.status === 404 && mcpApi.status === 404) {
            pass('port separation', 'admin /mcp 404; MCP /api/connectors 404');
        }
        else {
            fail('port separation', `admin /mcp ${String(adminMcp.status)}; MCP /api ${String(mcpApi.status)}`);
        }
    }
    {
        const empty = await unauthorizedBody(mcp.baseUrl, undefined);
        const unknown = await unauthorizedBody(mcp.baseUrl, `Bearer ${UNKNOWN_BEARER}`);
        if (empty.status === 401 &&
            unknown.status === 401 &&
            empty.text === unknown.text &&
            !empty.text.includes(FIXTURE_PASSWORD) &&
            !empty.text.includes(BEARER)) {
            pass('bearer rejection', 'empty and unknown bearer identical 401');
        }
        else {
            fail('bearer rejection', `empty=${String(empty.status)} unknown=${String(unknown.status)} equal=${String(empty.text === unknown.text)}`);
        }
    }
    await withClient(mcp.baseUrl, BEARER, async (client) => {
        const before = egressTransport.tlsSessionCallCount;
        let foreignRejected = false;
        let disabledRejected = false;
        try {
            await client.callTool({
                name: 'mailru_list_messages',
                arguments: { account: FOREIGN_ID, limit: 1 },
            });
        }
        catch (error) {
            foreignRejected = !errorMessage(error).includes(FIXTURE_PASSWORD);
        }
        try {
            await client.callTool({
                name: 'mailru_list_messages',
                arguments: { account: DISABLED_ID, limit: 1 },
            });
        }
        catch (error) {
            disabledRejected = !errorMessage(error).includes(FIXTURE_PASSWORD);
        }
        const noSession = egressTransport.tlsSessionCallCount === before;
        if (foreignRejected && disabledRejected && noSession) {
            pass('foreign and disabled account', 'rejected; fake TLS session count stayed 0');
        }
        else {
            fail('foreign and disabled account', `foreign=${String(foreignRejected)} disabled=${String(disabledRejected)} noSession=${String(noSession)}`);
        }
    });
    await withClient(mcp.baseUrl, BEARER, async (client) => {
        const listed = await client.listTools();
        const names = listed.tools.map((tool) => tool.name);
        const required = ['mailru_list_messages', 'mailru_search_messages', 'mailru_read_message'];
        const missing = required.filter((name) => !names.includes(name));
        const blob = JSON.stringify(listed);
        if (missing.length === 0 && !blob.includes(FIXTURE_PASSWORD) && !blob.includes('imap.mail.ru')) {
            pass('tools/list', `lists ${required.join(', ')}; password and host absent`);
        }
        else {
            fail('tools/list', `missing=${missing.join(',')} leak=${String(blob.includes(FIXTURE_PASSWORD))} host=${String(blob.includes('imap.mail.ru'))}`);
        }
    });
    await withClient(mcp.baseUrl, BEARER, async (client) => {
        const result = await client.callTool({
            name: 'mailru_list_messages',
            arguments: { account: ACCOUNT_ID, limit: 100 },
        });
        const text = toolText(result);
        const parsed = JSON.parse(text);
        const ok = Array.isArray(parsed) &&
            parsed.length <= 50 &&
            parsed.length > 0 &&
            !text.includes(FIXTURE_PASSWORD) &&
            parsed.every((summary) => typeof summary.uid === 'number' &&
                typeof summary.from === 'string' &&
                typeof summary.subject === 'string' &&
                typeof summary.date === 'string' &&
                typeof summary.seen === 'boolean' &&
                typeof summary.unread === 'boolean' &&
                !('textBody' in summary) &&
                !('body' in summary));
        if (ok) {
            pass('mailru_list_messages', `returned ${String(parsed.length)} capped summaries without bodies`);
        }
        else {
            fail('mailru_list_messages', `len=${String(parsed.length)} leak=${String(text.includes(FIXTURE_PASSWORD))}`);
        }
    });
    await withClient(mcp.baseUrl, BEARER, async (client) => {
        const result = await client.callTool({
            name: 'mailru_search_messages',
            arguments: { account: ACCOUNT_ID, filter: { from: 'alice@example.test' } },
        });
        const text = toolText(result);
        const parsed = JSON.parse(text);
        const ok = Array.isArray(parsed) &&
            parsed.length > 0 &&
            parsed.every((summary) => String(summary.from).includes('alice@example.test')) &&
            parsed.every((summary) => !('textBody' in summary) && !('body' in summary)) &&
            !text.includes(FIXTURE_PASSWORD);
        if (ok) {
            pass('mailru_search_messages filter', `matched ${String(parsed.length)} alice summaries`);
        }
        else {
            fail('mailru_search_messages filter', text.slice(0, 200));
        }
    });
    await withClient(mcp.baseUrl, BEARER, async (client) => {
        const before = egressTransport.tlsSessionCallCount;
        let stringRejected = false;
        let keyRejected = false;
        try {
            await client.callTool({
                name: 'mailru_search_messages',
                arguments: { account: ACCOUNT_ID, filter: 'OR FROM alice SUBJECT secret' },
            });
        }
        catch (error) {
            stringRejected = !errorMessage(error).includes(FIXTURE_PASSWORD);
        }
        try {
            await client.callTool({
                name: 'mailru_search_messages',
                arguments: { account: ACCOUNT_ID, filter: { raw: 'BEFORE 1-Jan-2020' } },
            });
        }
        catch (error) {
            keyRejected = !errorMessage(error).includes(FIXTURE_PASSWORD);
        }
        const noSession = egressTransport.tlsSessionCallCount === before;
        if (stringRejected && keyRejected && noSession) {
            pass('mailru_search_messages free-form', 'rejected without a new IMAP session; password absent');
        }
        else {
            fail('mailru_search_messages free-form', `string=${String(stringRejected)} key=${String(keyRejected)} noSession=${String(noSession)}`);
        }
    });
    await withClient(mcp.baseUrl, BEARER, async (client) => {
        const result = await client.callTool({
            name: 'mailru_read_message',
            arguments: { account: ACCOUNT_ID, uid: 42 },
        });
        const text = toolText(result);
        const parsed = JSON.parse(text);
        const ok = parsed.from === 'alice@example.test' &&
            parsed.to === FIXTURE_ADDRESS &&
            parsed.subject === 'With attachment' &&
            parsed.date === 'Mon, 1 Jan 2024 00:00:00 +0000' &&
            parsed.textBody === 'Readable text body' &&
            !text.includes(FIXTURE_PASSWORD) &&
            !text.includes(ATTACHMENT_BYTES);
        if (ok) {
            pass('mailru_read_message', 'headers and text body; no attachment bytes; password absent');
        }
        else {
            fail('mailru_read_message', text.slice(0, 300));
        }
    });
    {
        const scrubRegistry = buildConnectorRegistry([
            {
                ...mailruConnector,
                tools: mailruConnector.tools.map((tool) => tool.name === 'list_messages'
                    ? {
                        ...tool,
                        handler: () => {
                            throw new Error(`provider boom ${FIXTURE_PASSWORD}`);
                        },
                    }
                    : tool),
            },
        ]);
        const scrubTransport = createMailruFakeEgressTransport({
            imap: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD, messages },
            smtp: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD },
        });
        const scrubApp = createMcpApp({
            store: mailruStore(),
            connectorRegistry: scrubRegistry,
            egressTransport: scrubTransport,
        });
        const scrubMcp = await listen(scrubApp);
        try {
            await withClient(scrubMcp.baseUrl, BEARER, async (client) => {
                try {
                    await client.callTool({
                        name: 'mailru_list_messages',
                        arguments: { account: ACCOUNT_ID },
                    });
                    fail('password scrub error path', 'expected call to throw');
                }
                catch (error) {
                    const message = errorMessage(error);
                    if (!message.includes(FIXTURE_PASSWORD)) {
                        pass('password scrub', 'MCP error from a secret-bearing throw omits the fixture password');
                    }
                    else {
                        fail('password scrub', 'fixture password present in MCP error');
                    }
                }
            });
        }
        finally {
            await new Promise((resolve) => {
                scrubMcp.server.close(() => {
                    resolve();
                });
            });
        }
    }
    {
        const response = await fetch(`${admin.baseUrl}/api/connectors`);
        const json = (await response.json());
        const mailru = json.find((connector) => connector.id === 'mailru');
        const gmail = json.find((connector) => connector.id === 'gmail');
        const text = JSON.stringify(json);
        const ok = mailru?.name === 'Mail.ru' &&
            mailru.kind === 'native' &&
            mailru.fields?.some((field) => field.name === 'address' &&
                field.label === 'Address' &&
                field.type === 'text' &&
                field.required === true) === true &&
            mailru.fields?.some((field) => field.name === 'password' &&
                field.label === 'App password' &&
                field.type === 'secret' &&
                field.required === true) === true &&
            gmail?.id === 'gmail' &&
            !text.includes(FIXTURE_PASSWORD);
        if (ok) {
            pass('connectors list', 'Mail.ru Address and App password; Gmail still listed; password absent');
        }
        else {
            fail('connectors list', JSON.stringify(mailru));
        }
    }
    async function createAttempt(name, imapAccept, smtpAccept, expectStatus, expectBody) {
        const emptyStore = createMemoryStore({});
        const transport = createMailruFakeEgressTransport({
            imap: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD, acceptLogin: imapAccept },
            smtp: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD, acceptAuth: smtpAccept },
        });
        const app = createAdminApp({
            store: emptyStore,
            connectorRegistry: registry,
            egressTransport: transport,
        });
        const listener = await listen(app);
        try {
            const response = await fetch(`${listener.baseUrl}/api/accounts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    connector: 'mailru',
                    label: 'Inbox',
                    values: { address: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD },
                }),
            });
            const text = await response.text();
            const accounts = emptyStore.read().accounts ?? [];
            const bodyOk = expectBody === undefined ? !text.includes(FIXTURE_PASSWORD) : text === expectBody;
            const savedOk = expectStatus === 201 ? accounts.length === 1 : accounts.length === 0;
            if (response.status === expectStatus && bodyOk && savedOk && !text.includes(FIXTURE_PASSWORD)) {
                pass(name, `${String(expectStatus)}; password absent`);
            }
            else {
                fail(name, `${String(response.status)} ${text.slice(0, 200)}`);
            }
            if (expectStatus === 201) {
                const listed = await fetch(`${listener.baseUrl}/api/accounts`);
                const listedText = await listed.text();
                const created = JSON.parse(text);
                const patched = await fetch(`${listener.baseUrl}/api/accounts/${created.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ label: 'Renamed inbox', values: { address: FIXTURE_ADDRESS, password: '' } }),
                });
                const patchedText = await patched.text();
                const checked = await fetch(`${listener.baseUrl}/api/accounts/${created.id}/check`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}',
                });
                const checkedText = await checked.text();
                if (listed.status === 200 &&
                    patched.status === 200 &&
                    checked.status === 200 &&
                    !listedText.includes(FIXTURE_PASSWORD) &&
                    !patchedText.includes(FIXTURE_PASSWORD) &&
                    !checkedText.includes(FIXTURE_PASSWORD)) {
                    pass('admin list patch check', 'list, patch, and check bodies omit the fixture password');
                }
                else {
                    fail('admin list patch check', `list=${String(listed.status)} patch=${String(patched.status)} check=${String(checked.status)}`);
                }
            }
        }
        finally {
            await new Promise((resolve) => {
                listener.server.close(() => {
                    resolve();
                });
            });
        }
    }
    await createAttempt('admin create success', true, true, 201, undefined);
    await createAttempt('admin create IMAP reject', false, true, 400, 'Connection check failed');
    await createAttempt('admin create SMTP reject', true, false, 400, 'Connection check failed');
}
finally {
    await new Promise((resolve) => {
        mcp.server.close(() => {
            resolve();
        });
    });
    await new Promise((resolve) => {
        admin.server.close(() => {
            resolve();
        });
    });
}
const failed = results.filter((result) => !result.ok);
console.log(`SUMMARY passed=${String(results.length - failed.length)} failed=${String(failed.length)}`);
if (failed.length > 0) {
    process.exitCode = 1;
}
