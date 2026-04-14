/**
 * Task Analyzer — Entry Point
 * Unified MCP server wrapping task-master + git-nexus
 *
 * Runs on Streamable HTTP transport for MCP 2025+ clients.
 * Supports session management and SSE streaming.
 */

import express from 'express';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer as createMCPServer } from './server.js';
import { log } from './utils.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

const PORT = parseInt(process.env.PORT ?? '3100', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

// Session storage
const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: Server }>();

async function main() {
  // ── Bootstrap local modules (install + build if needed) ──
  const { bootstrap } = await import('./utils.js');
  log.info('Bootstrapping local modules (gitnexus-shared → gitnexus → task-master)...');
  await bootstrap();

  const app = express();
  app.use(express.json());

  // ─── MCP Streamable HTTP endpoint ───

  app.post('/mcp', async (req, res) => {
    try {
      // Check for existing session
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (sessionId && sessions.has(sessionId)) {
        // Reuse existing session
        const session = sessions.get(sessionId)!;
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      // New session — check if this is an initialize request
      if (isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });
        const server = createMCPServer();

        await server.connect(transport);

        // Store session after connect (sessionId now available)
        const newSessionId = transport.sessionId;
        if (newSessionId) {
          sessions.set(newSessionId, { transport, server });
          log.info(`New session: ${newSessionId}`);
        }

        // Cleanup on close
        transport.onclose = () => {
          if (newSessionId) {
            sessions.delete(newSessionId);
            log.info(`Session closed: ${newSessionId}`);
          }
        };

        await transport.handleRequest(req, res, req.body);
      } else {
        // No session and not an initialize request
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'No session. Send initialize request first.',
          },
          id: req.body?.id ?? null,
        });
      }
    } catch (err: any) {
      log.error(`Request error: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: err.message },
          id: req.body?.id ?? null,
        });
      }
    }
  });

  // ─── GET /mcp — SSE stream for server-initiated messages ───

  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' });
      return;
    }

    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
  });

  // ─── DELETE /mcp — Close session ───

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.transport.close();
      sessions.delete(sessionId);
      res.status(200).json({ status: 'closed' });
      log.info(`Session deleted: ${sessionId}`);
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  });

  // ─── Health check ───

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: '1.1.0',
      transport: 'streamable-http',
      sessions: sessions.size,
      uptime: process.uptime(),
    });
  });

  // ─── Start server ───

  app.listen(PORT, HOST, () => {
    log.info(`Task Analyzer MCP Server v1.1.0`);
    log.info(`Transport: Streamable HTTP`);
    log.info(`Listening: http://${HOST}:${PORT}/mcp`);
    log.info(`Health:    http://${HOST}:${PORT}/health`);
  });

  // ─── Graceful shutdown ───

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('Shutting down...');

    for (const [id, session] of sessions) {
      try {
        await session.server.close();
        await session.transport.close();
      } catch {}
      sessions.delete(id);
    }

    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  process.on('uncaughtException', (err) => {
    log.error(`Uncaught: ${err.stack ?? err.message}`);
  });

  process.on('unhandledRejection', (reason: any) => {
    log.error(`Unhandled: ${reason?.stack ?? reason}`);
  });
}

// ─── Helpers ───

function isInitializeRequest(body: any): boolean {
  if (Array.isArray(body)) {
    return body.some((msg: any) => msg.method === 'initialize');
  }
  return body?.method === 'initialize';
}

main().catch((err) => {
  log.error(`Fatal: ${err.message}`);
  process.exit(1);
});
