import { Inject, Injectable } from '@nestjs/common';
import type { CustomerDto } from '@barat/contracts';

import { DomainErrors } from '../../common/errors/domain.exception';
import { IDENTITY_DATABASE, type IdentityDatabase } from './identity.tokens';
import { maskEmail, maskMobile } from './identity.utils';

/**
 * Read-side projection of a customer.
 *
 * Identity values are always masked on the way out; the raw mobile number and
 * e-mail address never leave the API in a customer-facing response.
 */
@Injectable()
export class CustomerReadService {
  constructor(@Inject(IDENTITY_DATABASE) private readonly database: IdentityDatabase) {}

  async customerDto(customerId: string): Promise<CustomerDto> {
    const customer = await this.database.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        customerCode: true,
        status: true,
        createdAt: true,
        profile: { select: { firstName: true, lastName: true } },
        identities: { select: { type: true, valueNormalized: true, isVerified: true } },
      },
    });
    if (!customer) {
      throw DomainErrors.notFound('Customer');
    }

    const mobile = customer.identities.find((identity) => identity.type === 'MOBILE');
    const email = customer.identities.find((identity) => identity.type === 'EMAIL');

    return {
      id: customer.id,
      customerCode: customer.customerCode,
      status: customer.status,
      firstName: customer.profile?.firstName ?? null,
      lastName: customer.profile?.lastName ?? null,
      maskedMobile: mobile ? maskMobile(mobile.valueNormalized) : null,
      maskedEmail: email ? maskEmail(email.valueNormalized) : null,
      isMobileVerified: mobile?.isVerified ?? false,
      isEmailVerified: email?.isVerified ?? false,
      createdAt: customer.createdAt.toISOString(),
    };
  }
}
