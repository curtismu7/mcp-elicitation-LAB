import { PROTOCOL } from './engine.js';

export const DEMO = { id: 'mcp-elicitation-lab', name: 'MCP Elicitation LAB', version: '0.1.0' };

// Where every spec claim in this lab comes from. Pages not listed were NOT read: anything beyond them is UNVERIFIED.
export const SPEC_SOURCES = {
  protocol: PROTOCOL,
  read: '2026-10-22',
  pages: [
    { id: '2025-11-25', url: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation', status: 'read in full' },
    { id: 'draft', url: 'https://modelcontextprotocol.io/specification/draft/client/elicitation', status: 'read in full; unstable' },
  ],
  notRead: ['basic/security_best_practices', 'basic/authorization', 'basic/patterns/mrtr'],
  draftDifferences: [
    'The client capability moves to _meta."io.modelcontextprotocol/clientCapabilities" on each request (2025-11-25: declared once at initialize).',
    'Elicitation arrives inside an InputRequiredResult and the client retries the original request with the answers (multi round-trip), instead of a server-to-client elicitation/create request.',
    'No elicitationId, no -32042 URLElicitationRequired and no notifications/elicitation/complete in the draft page. This lab targets 2025-11-25.',
    'The same three actions (accept, decline, cancel), the same flat form schema and the same safety rules. The draft drops rate limiting from the security list and the pattern keyword from its string example.',
  ],
};
