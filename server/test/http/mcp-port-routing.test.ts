import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createMcpApp } from '../../src/http/createMcpApp.js';

/** Test canaries that must never appear in MCP responses. */
const DATA_DIR = 'C:\\fake-data-dir-mcp-port-routing-UNIQUE';
const ENCRYPTION_KEY = 'c3Bhd24tdGVzdC1rZXktMzItYnl0ZXMtcGFkZGVkISE=';
const MCP_HOST = 'mcp-host-canary.example';
const MCP_PORT = '18765';
const ADMIN_HOST = 'admin-host-canary.example';
const ADMIN_PORT = '18766';
const BEARER = 'Bearer secret-token-canary-7e2c-UNIQUE';

const SECRET_CANARIES = [DATA_DIR, ENCRYPTION_KEY, MCP_HOST, MCP_PORT, ADMIN_HOST, ADMIN_PORT];

function assertNoSecrets(body: string): void {
  for (const canary of SECRET_CANARIES) {
    expect(body).not.toContain(canary);
  }
}

describe('mcp-port-routing: GET /health на порту MCP без аутентификации', () => {
  it('GET /health без Authorization', async () => {
    const app = createMcpApp();
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({ status: 'ok' });
    assertNoSecrets(response.text);
  });

  it('GET /health с Authorization не меняет ответ', async () => {
    const app = createMcpApp();
    const response = await request(app).get('/health').set('Authorization', BEARER);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.text).not.toContain(BEARER);
    expect(response.text).not.toContain('secret-token-canary-7e2c-UNIQUE');
    assertNoSecrets(response.text);
  });

  it('GET /health с query string', async () => {
    const app = createMcpApp();
    const response = await request(app).get('/health?x=1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});

describe('mcp-port-routing: /mcp на порту MCP возвращает 501', () => {
  it('GET /mcp — 501 без секретов', async () => {
    const app = createMcpApp();
    const response = await request(app).get('/mcp');

    expect(response.status).toBe(501);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toBe('Not Implemented');
    assertNoSecrets(response.text);
  });

  it('POST /mcp — 501 без секретов', async () => {
    const app = createMcpApp();
    const response = await request(app).post('/mcp').send({ anything: true });

    expect(response.status).toBe(501);
    expect(response.text).toBe('Not Implemented');
    assertNoSecrets(response.text);
  });
});

describe('mcp-port-routing: Чужой путь на порту MCP — 404', () => {
  it('Неизвестный путь — 404', async () => {
    const app = createMcpApp();
    const response = await request(app).get('/unknown');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toBe('Not Found');
    assertNoSecrets(response.text);
  });

  it('POST /health — 404', async () => {
    const app = createMcpApp();
    const response = await request(app).post('/health');

    expect(response.status).toBe(404);
    expect(response.text).toBe('Not Found');
  });

  it('PUT /health — 404', async () => {
    const app = createMcpApp();
    const response = await request(app).put('/health');

    expect(response.status).toBe(404);
    expect(response.text).toBe('Not Found');
  });

  it('DELETE /health — 404', async () => {
    const app = createMcpApp();
    const response = await request(app).delete('/health');

    expect(response.status).toBe(404);
    expect(response.text).toBe('Not Found');
  });

  it('GET /health/ — 404', async () => {
    const app = createMcpApp();
    const response = await request(app).get('/health/');

    expect(response.status).toBe(404);
    expect(response.text).toBe('Not Found');
  });
});
