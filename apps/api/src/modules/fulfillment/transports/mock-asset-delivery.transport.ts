import { Injectable } from '@nestjs/common';

import type {
  AssetDeliveryMessage,
  AssetDeliveryResult,
  AssetDeliveryTransport,
} from '../fulfillment.types';

/**
 * The POC delivery transport.
 *
 * The real e-mail provider is an `integrations/` adapter owned by another
 * workstream; this module talks to the port, never to a provider (AGENTS.md
 * rule 6). Swapping it out is a one-line provider change in `FulfillmentModule`.
 *
 * It logs the message id and the masked recipient and NOTHING else. In
 * particular it never logs `message.code` or `message.pin`, and it never stores
 * them — the plaintext exists only for the duration of the call.
 */
@Injectable()
export class MockAssetDeliveryTransport implements AssetDeliveryTransport {
  readonly name = 'mock-email';

  private outcome: AssetDeliveryResult = { success: true };
  private sendCount = 0;

  async send(message: AssetDeliveryMessage): Promise<AssetDeliveryResult> {
    this.sendCount += 1;
    // A `void` reference, not a log line: the message object holds a plaintext
    // code and must never reach a logger or a serialiser.
    void message;
    return this.outcome.success
      ? { success: true, providerMessageId: `mock-${this.sendCount}` }
      : this.outcome;
  }

  /** Test hook: force the next sends to fail with a normalised code. */
  setOutcome(outcome: AssetDeliveryResult): void {
    this.outcome = outcome;
  }

  getSendCount(): number {
    return this.sendCount;
  }
}
