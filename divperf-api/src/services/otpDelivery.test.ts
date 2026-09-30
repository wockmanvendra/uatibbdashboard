import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';

vi.mock('../config.js', () => ({
  config: {
    SMS_URL: 'https://sms.example/API/sms.php',
    SMS_USERNAME: 'wock',
    SMS_PASSWORD: 's3cret',
    SMS_FROM: 'WOCKHD',
    SMS_TEMPLATE_ID: '1707000000000000001',
    SMS_OTP_TEXT: 'Your dashboard OTP is {otp}. Do not share it.',
    OTP_EXPIRY_MINUTES: 10,
  },
}));

const { deliverOtp } = await import('./otpDelivery.js');

const log = () => ({ error: vi.fn(), info: vi.fn() }) as unknown as FastifyBaseLogger & { error: ReturnType<typeof vi.fn> };
const who = { name: 'Field Rep', mobileno: '9000000002', email: 'rep@example.com' };

afterEach(() => vi.unstubAllGlobals());

describe('deliverOtp', () => {
  it('sends the SMS with the gateway parameters the D2D portal uses', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await deliverOtp(who, '482913', log());

    expect(result).toEqual({ attempted: 1, sent: 1 }); // email is not configured here
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      username: 'wock',
      password: 's3cret',
      from: 'WOCKHD',
      to: '9000000002',
      msg: 'Your dashboard OTP is 482913. Do not share it.',
      type: '1',
      template_id: '1707000000000000001',
    });
  });

  it('reports a gateway failure without throwing, and never logs the code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad template', { status: 500 })));
    const logger = log();

    expect(await deliverOtp(who, '482913', logger)).toEqual({ attempted: 1, sent: 0 });
    expect(logger.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('482913');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('9000000002');
  });
});
