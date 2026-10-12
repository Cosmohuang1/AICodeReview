import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import type { Request, Response } from 'express';

vi.mock('../../src/pipeline.js', () => ({
  runReviewPipeline: vi.fn().mockResolvedValue(undefined),
}));

import { runReviewPipeline } from '../../src/pipeline.js';
import { verifySignature, webhookHandler } from '../../src/server/webhook.handler.js';

function computeSignature(payload: Buffer | string, secret: string): string {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  return `sha256=${crypto.createHmac('sha256', secret).update(buf).digest('hex')}`;
}

describe('verifySignature', () => {
  const secret = 'my-webhook-secret';
  const payload = Buffer.from(JSON.stringify({ hello: 'world' }));

  it('returns true for valid signature matching payload Buffer', () => {
    const signature = computeSignature(payload, secret);
    expect(verifySignature(payload, signature, secret)).toBe(true);
  });

  it('returns true when payload is string and signature matches', () => {
    const strPayload = '{"action":"opened"}';
    const signature = computeSignature(strPayload, secret);
    expect(verifySignature(strPayload as any, signature, secret)).toBe(true);
  });

  it('returns false when signature header is undefined', () => {
    expect(verifySignature(payload, undefined, secret)).toBe(false);
  });

  it('returns false when signature header is empty string', () => {
    expect(verifySignature(payload, '', secret)).toBe(false);
  });

  it('returns false when signature does not match', () => {
    const fakeSignature = 'sha256=abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    expect(verifySignature(payload, fakeSignature, secret)).toBe(false);
  });

  it('returns false when signature was generated with different secret', () => {
    const wrongSignature = computeSignature(payload, 'wrong-secret');
    expect(verifySignature(payload, wrongSignature, secret)).toBe(false);
  });

  it('returns false when signature has different length without throwing', () => {
    expect(verifySignature(payload, 'sha256=short', secret)).toBe(false);
    expect(verifySignature(payload, 'invalid', secret)).toBe(false);
  });
});

describe('webhookHandler', () => {
  const secret = 'test-secret';
  let originalSecret: string | undefined;

  beforeEach(() => {
    originalSecret = process.env.GITHUB_WEBHOOK_SECRET;
    process.env.GITHUB_WEBHOOK_SECRET = secret;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalSecret !== undefined) {
      process.env.GITHUB_WEBHOOK_SECRET = originalSecret;
    } else {
      delete process.env.GITHUB_WEBHOOK_SECRET;
    }
  });

  function createMockRes() {
    const res: Partial<Response> = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res as Response;
  }

  function createMockReq(options: {
    event?: string;
    payload?: any;
    rawBody?: Buffer | string;
    signature?: string;
  }) {
    const payloadObj = options.payload ?? { action: 'opened' };
    const rawBody = options.rawBody !== undefined
      ? (Buffer.isBuffer(options.rawBody) ? options.rawBody : Buffer.from(options.rawBody))
      : Buffer.from(JSON.stringify(payloadObj));
    const signature = options.signature !== undefined
      ? options.signature
      : computeSignature(rawBody, secret);

    const headers: Record<string, string | undefined> = {};
    if (options.event !== undefined) {
      headers['x-github-event'] = options.event;
    }
    if (signature) {
      headers['x-hub-signature-256'] = signature;
    }

    const req: Partial<Request> = {
      headers,
      body: rawBody,
    };
    return req as Request;
  }

  describe('signature verification', () => {
    it('returns 401 when signature header is missing', async () => {
      const req = createMockReq({
        event: 'pull_request',
        payload: { action: 'opened' },
        signature: '',
      });
      const res = createMockRes();

      await webhookHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid signature' });
      expect(runReviewPipeline).not.toHaveBeenCalled();
    });

    it('returns 401 when signature is invalid', async () => {
      const req = createMockReq({
        event: 'pull_request',
        payload: { action: 'opened' },
        signature: 'sha256=invalid0000000000000000000000000000000000000000000000000000000000',
      });
      const res = createMockRes();

      await webhookHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid signature' });
      expect(runReviewPipeline).not.toHaveBeenCalled();
    });
  });

  describe('event and action filtering', () => {
    it('returns 200 with "Event ignored" for non-pr event (e.g. push)', async () => {
      const req = createMockReq({
        event: 'push',
        payload: { ref: 'refs/heads/main' },
      });
      const res = createMockRes();

      await webhookHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Event ignored' });
      expect(runReviewPipeline).not.toHaveBeenCalled();
    });

    it('returns 200 with "Event ignored" for non-pr event (e.g. issues)', async () => {
      const req = createMockReq({
        event: 'issues',
        payload: { action: 'opened' },
      });
      const res = createMockRes();

      await webhookHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Event ignored' });
      expect(runReviewPipeline).not.toHaveBeenCalled();
    });

    it('returns 200 with "Event ignored" for unhandled PR action (e.g. closed)', async () => {
      const req = createMockReq({
        event: 'pull_request',
        payload: {
          action: 'closed',
          pull_request: { number: 1, title: 'Test PR', draft: false },
        },
      });
      const res = createMockRes();

      await webhookHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Event ignored' });
      expect(runReviewPipeline).not.toHaveBeenCalled();
    });

    it('returns 200 with "Event ignored" for unhandled PR action (e.g. labeled)', async () => {
      const req = createMockReq({
        event: 'pull_request',
        payload: {
          action: 'labeled',
          pull_request: { number: 1, title: 'Test PR', draft: false },
        },
      });
      const res = createMockRes();

      await webhookHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Event ignored' });
      expect(runReviewPipeline).not.toHaveBeenCalled();
    });
  });

  describe('draft PR handling', () => {
    it('returns 200 with "Draft PR skipped" for opened draft PR', async () => {
      const req = createMockReq({
        event: 'pull_request',
        payload: {
          action: 'opened',
          pull_request: { number: 12, title: 'Draft WIP', draft: true },
          repository: { name: 'test-repo', owner: { login: 'test-owner' } },
          installation: { id: 999 },
        },
      });
      const res = createMockRes();

      await webhookHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Draft PR skipped' });
      expect(runReviewPipeline).not.toHaveBeenCalled();
    });

    it('returns 200 with "Draft PR skipped" for synchronize draft PR', async () => {
      const req = createMockReq({
        event: 'pull_request',
        payload: {
          action: 'synchronize',
          pull_request: { number: 12, title: 'Draft WIP', draft: true },
          repository: { name: 'test-repo', owner: { login: 'test-owner' } },
          installation: { id: 999 },
        },
      });
      const res = createMockRes();

      await webhookHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Draft PR skipped' });
      expect(runReviewPipeline).not.toHaveBeenCalled();
    });
  });

  describe('valid PR events (opened and synchronize)', () => {
    it('handles pull_request opened, returns 200 and triggers runReviewPipeline', async () => {
      const payload = {
        action: 'opened',
        pull_request: {
          number: 42,
          title: 'Implement feature X',
          draft: false,
        },
        repository: {
          name: 'ai-review',
          owner: { login: 'test-owner' },
        },
        installation: {
          id: 12345,
        },
      };

      const req = createMockReq({
        event: 'pull_request',
        payload,
      });
      const res = createMockRes();

      await webhookHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Review started' });

      // Wait for setImmediate to execute background task
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(runReviewPipeline).toHaveBeenCalledTimes(1);
      expect(runReviewPipeline).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'ai-review',
        prNumber: 42,
        prTitle: 'Implement feature X',
        installationId: 12345,
      });
    });

    it('handles pull_request synchronize, returns 200 and triggers runReviewPipeline', async () => {
      const payload = {
        action: 'synchronize',
        pull_request: {
          number: 77,
          title: 'Update feature X commits',
          draft: false,
        },
        repository: {
          name: 'ai-review',
          owner: { login: 'test-owner' },
        },
        installation: {
          id: 67890,
        },
      };

      const req = createMockReq({
        event: 'pull_request',
        payload,
      });
      const res = createMockRes();

      await webhookHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Review started' });

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(runReviewPipeline).toHaveBeenCalledTimes(1);
      expect(runReviewPipeline).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'ai-review',
        prNumber: 77,
        prTitle: 'Update feature X commits',
        installationId: 67890,
      });
    });
  });

  describe('error handling', () => {
    it('returns 400 when raw body contains invalid JSON', async () => {
      const badBuffer = Buffer.from('{ invalid-json');
      const signature = computeSignature(badBuffer, secret);
      const req = {
        headers: {
          'x-github-event': 'pull_request',
          'x-hub-signature-256': signature,
        },
        body: badBuffer,
      } as unknown as Request;
      const res = createMockRes();

      await webhookHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(/invalid json/i) })
      );
      expect(runReviewPipeline).not.toHaveBeenCalled();
    });

    it('handles pipeline background failure gracefully without uncaught rejection', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(runReviewPipeline).mockRejectedValueOnce(new Error('GitHub API down'));

      const payload = {
        action: 'opened',
        pull_request: { number: 10, title: 'Failing PR', draft: false },
        repository: { name: 'repo', owner: { login: 'owner' } },
        installation: { id: 111 },
      };

      const req = createMockReq({
        event: 'pull_request',
        payload,
      });
      const res = createMockRes();

      await webhookHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Review started' });

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ai-review] Pipeline error:'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('handles payload with missing optional fields safely', async () => {
      const payload = {
        action: 'opened',
        pull_request: {
          number: 55,
          title: 'PR without installation',
          draft: false,
        },
      };

      const req = createMockReq({
        event: 'pull_request',
        payload,
      });
      const res = createMockRes();

      await webhookHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Review started' });

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(runReviewPipeline).toHaveBeenCalledWith({
        owner: '',
        repo: '',
        prNumber: 55,
        prTitle: 'PR without installation',
        installationId: 0,
      });
    });
  });
});
