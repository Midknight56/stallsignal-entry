export const SANDBOX = 'https://api-m.sandbox.paypal.com';
export type Fault =
  | 'lose_next_response'
  | 'capture_pending'
  | 'decline_next_capture'
  | 'decline_next_card'
  | 'refund_pending'
  | 'refund_fails';
export type WriteKind = 'create' | 'capture' | 'refund' | 'card';
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export interface PayPalEnv {
  PAYPAL_CLIENT_ID: string;
  PAYPAL_SECRET: string;
  PAYPAL_WEBHOOK_ID: string;
  PAYPAL_BASE?: string;
  DEV_ROUTES?: string;
}
export interface Resource {
  id?: string;
  status?: string;
  custom_id?: string;
  debug_id?: string;
  name?: string;
  verification_status?: string;
  simulated?: boolean;
  details?: { issue?: string }[];
  links?: { rel: string; href: string }[];
  purchase_units?: { custom_id?: string; payments?: { captures?: Resource[] } }[];
  supplementary_data?: { related_ids?: { order_id?: string; capture_id?: string } };
}
export interface PayPalResult {
  ok: boolean;
  status: number;
  body: Resource;
  debugId: string | null;
}
export class WriteNotSent extends Error {
  constructor() {
    super('Payment request was not sent.');
  }
}
export class LostResponse extends Error {
  constructor(readonly simulated = false) {
    super('Payment response unavailable. Reconcile before another write.');
  }
}
const tokens = new Map<string, { value: string; expires: number }>();

export class PayPal {
  constructor(
    readonly env: PayPalEnv,
    readonly fetcher: Fetch = (input, init) => fetch(input, init),
    readonly clock: () => number = Date.now,
    readonly takeFault?: (kind: WriteKind) => Promise<Fault | null>,
  ) {
    if (env.PAYPAL_BASE && env.PAYPAL_BASE !== SANDBOX) throw new Error('Sandbox endpoint required');
  }
  async testCardSource() {
    if (this.env.PAYPAL_BASE !== SANDBOX) throw new WriteNotSent();
    const fault = this.env.DEV_ROUTES === '1' ? await this.takeFault?.('card') : null;
    const expiry = new Date(this.clock());
    return {
      card: {
        // PayPal's published sandbox Visa list, read 8 Nov 2026:
        // https://developer.paypal.com/tools/sandbox/card-testing/
        number: '4012888888881881',
        expiry: `${expiry.getUTCFullYear() + 2}-${String(expiry.getUTCMonth() + 1).padStart(2, '0')}`,
        security_code: '123',
        // Published "Card refused" trigger (DO_NOT_HONOR), sent to the real sandbox.
        name: fault === 'decline_next_card' ? 'CCREJECT-REFUSED' : 'Test Buyer',
        billing_address: {
          address_line_1: '1 Harbour St',
          admin_area_2: 'Portland',
          admin_area_1: 'ME',
          postal_code: '04101',
          country_code: 'US',
        },
      },
    };
  }
  private async token(): Promise<string> {
    if (!this.env.PAYPAL_CLIENT_ID || !this.env.PAYPAL_SECRET)
      throw new Error('Payment credentials unavailable');
    const cached = tokens.get(this.env.PAYPAL_CLIENT_ID);
    if (cached && cached.expires > this.clock()) return cached.value;
    const res = await this.fetcher(`${SANDBOX}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${this.env.PAYPAL_CLIENT_ID}:${this.env.PAYPAL_SECRET}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error('Payment authentication unavailable');
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token || !body.expires_in) throw new Error('Payment authentication unavailable');
    tokens.set(this.env.PAYPAL_CLIENT_ID, {
      value: body.access_token,
      expires: this.clock() + (body.expires_in - 60) * 1000,
    });
    return body.access_token;
  }
  private async request(
    method: string,
    path: string,
    body?: object,
    requestId?: string,
    kind?: WriteKind,
  ): Promise<PayPalResult> {
    let writeSent = false;
    try {
      const token = await this.token();
      const fault = kind && this.env.DEV_ROUTES === '1' ? await this.takeFault?.(kind) : null;
      if (fault === 'decline_next_capture')
        return {
          ok: false,
          status: 422,
          body: { status: 'DECLINED', details: [{ issue: 'INSTRUMENT_DECLINED' }], simulated: true },
          debugId: null,
        };
      if (fault === 'refund_fails')
        return { ok: false, status: 422, body: { name: 'REFUND_FAILED', simulated: true }, debugId: null };
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
          ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      };
      let res: Response;
      try {
        writeSent = true;
        res = await this.fetcher(`${SANDBOX}${path}`, init);
      } catch {
        if (kind) throw new LostResponse();
        throw new Error('Payment read unavailable');
      }
      if (kind && (fault === 'lose_next_response' || res.status >= 500))
        throw new LostResponse(fault === 'lose_next_response');
      let parsed: Resource;
      try {
        parsed = (await res.json()) as Resource;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      } catch {
        if (kind) throw new LostResponse();
        throw new Error('Payment read unavailable');
      }
      if (res.ok && fault === 'capture_pending') {
        parsed = {
          ...parsed,
          simulated: true,
          purchase_units: parsed.purchase_units?.map((unit) => ({
            ...unit,
            payments: { captures: unit.payments?.captures?.map((c) => ({ ...c, status: 'PENDING' })) },
          })),
        };
      }
      if (res.ok && fault === 'refund_pending') parsed = { ...parsed, status: 'PENDING', simulated: true };
      return {
        ok: res.ok,
        status: res.status,
        body: parsed,
        debugId: res.headers.get('paypal-debug-id') ?? parsed.debug_id ?? null,
      };
    } catch (error) {
      if (kind && !(error instanceof LostResponse)) throw writeSent ? new LostResponse() : new WriteNotSent();
      throw error;
    }
  }
  createOrder(body: object, requestId: string) {
    if (
      'payment_source' in body &&
      (body.payment_source as { card?: unknown })?.card &&
      this.env.PAYPAL_BASE !== SANDBOX
    )
      throw new WriteNotSent();
    return this.request('POST', '/v2/checkout/orders', body, requestId, 'create');
  }
  captureOrder(id: string, requestId: string) {
    return this.request(
      'POST',
      `/v2/checkout/orders/${encodeURIComponent(id)}/capture`,
      {},
      requestId,
      'capture',
    );
  }
  getOrder(id: string) {
    return this.request('GET', `/v2/checkout/orders/${encodeURIComponent(id)}`);
  }
  getCapture(id: string) {
    return this.request('GET', `/v2/payments/captures/${encodeURIComponent(id)}`);
  }
  refundCapture(id: string, body: object, requestId: string) {
    return this.request(
      'POST',
      `/v2/payments/captures/${encodeURIComponent(id)}/refund`,
      body,
      requestId,
      'refund',
    );
  }
  getRefund(id: string) {
    return this.request('GET', `/v2/payments/refunds/${encodeURIComponent(id)}`);
  }
  async verifyWebhook(headers: Headers, raw: string): Promise<boolean> {
    const fields: Record<string, unknown> = { webhook_id: this.env.PAYPAL_WEBHOOK_ID };
    if (!this.env.PAYPAL_WEBHOOK_ID) return false;
    for (const [field, header] of [
      ['auth_algo', 'paypal-auth-algo'],
      ['cert_url', 'paypal-cert-url'],
      ['transmission_id', 'paypal-transmission-id'],
      ['transmission_sig', 'paypal-transmission-sig'],
      ['transmission_time', 'paypal-transmission-time'],
    ]) {
      const value = headers.get(header);
      if (!value) return false;
      fields[field] = value;
    }
    try {
      fields.webhook_event = JSON.parse(raw);
      const result = await this.request('POST', '/v1/notifications/verify-webhook-signature', fields);
      return result.ok && result.body.verification_status === 'SUCCESS';
    } catch {
      return false;
    }
  }
}
export function orderCapture(body: Resource): Resource | undefined {
  return body.purchase_units?.[0]?.payments?.captures?.[0];
}
