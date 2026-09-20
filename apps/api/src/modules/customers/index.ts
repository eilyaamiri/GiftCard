export { CustomersModule } from './customers.module';
export { AccountService, paginate } from './account.service';
export { CustomersService } from './customers.service';
export { SupportService, type SupportTicketDto } from './support.service';
export {
  SUPPORT_CHANNELS_DATABASE,
  SupportChannelsService,
  type AdminSupportChannelDto,
  type PublicSupportChannelDto,
  type SupportChannelsDatabase,
} from './support-channels.service';
export { CUSTOMERS_DATABASE, type CustomersDatabase } from './customers.tokens';
export type {
  AccountOrderDto,
  AccountPaymentDto,
  AccountRefundDto,
  Customer360Dto,
  CustomerProfileDto,
  CustomerSearchHit,
  PagedResult,
} from './customers.types';
