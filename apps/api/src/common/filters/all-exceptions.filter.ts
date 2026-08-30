import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { BaratDomainException } from '../errors/domain.exception';

interface HttpRequest {
  readonly id?: unknown;
  readonly url: string;
  readonly method: string;
}

interface HttpResponse {
  status(statusCode: number): HttpResponse;
  json(body: unknown): void;
}

/**
 * The single exit point for every error the API produces.
 *
 * Contract:
 *   - The response body always matches `ApiError` from @barat/contracts.
 *   - `code` is a stable machine key; `message` is a safe Persian sentence.
 *   - A provider message, SQL text, stack trace, file path, merchant id or
 *     gateway authority NEVER reaches the client. Those go to the log, keyed by
 *     `requestId`, so support can correlate without the customer seeing them.
 *   - An unrecognised error is always 500 INTERNAL_ERROR with a generic message.
 *     Leaking "duplicate key value violates unique constraint payment_authority"
 *     tells an attacker more than it helps anyone.
 */
@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<HttpResponse>();
    const request = ctx.getRequest<HttpRequest>();
    const requestId = typeof request.id === 'string' ? request.id : undefined;

    const { status, code, message, details } = this.normalise(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        {
          err: exception instanceof Error ? exception : new Error(String(exception)),
          requestId,
          path: request.url,
          method: request.method,
          code,
        },
        'Unhandled exception',
      );
    } else {
      this.logger.warn(
        { requestId, path: request.url, method: request.method, status, code },
        'Request rejected',
      );
    }

    response.status(status).json({
      statusCode: status,
      code,
      message,
      ...(details ? { details } : {}),
      ...(requestId ? { requestId } : {}),
      timestamp: new Date().toISOString(),
    });
  }

  private normalise(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: Array<{ path: string; message: string }>;
  } {
    /* Our own domain errors already carry a safe code and message. */
    if (exception instanceof BaratDomainException) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.safeMessage,
        ...(exception.details ? { details: exception.details } : {}),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      /* Nest's ValidationPipe produces { message: string[] }. */
      if (typeof payload === 'object' && payload !== null) {
        const record = payload as Record<string, unknown>;
        const rawMessages = record['message'];

        if (Array.isArray(rawMessages)) {
          return {
            status,
            code: 'VALIDATION_ERROR',
            message: 'اطلاعات ارسال‌شده معتبر نیست.',
            details: rawMessages.map((entry) => ({ path: '', message: String(entry) })),
          };
        }

        const code = defaultCodeFor(status);

        /*
         * Never trust an arbitrary HttpException's code or message. A provider
         * adapter could wrap its raw response in BadGatewayException; echoing
         * that payload can leak an authority, merchant identifier or upstream
         * URL. Modules that need a specific customer-facing code/sentence must
         * raise a BaratDomainException, whose safe fields are explicit by design.
         */
        return { status, code, message: defaultMessageFor(status) };
      }

      return { status, code: defaultCodeFor(status), message: defaultMessageFor(status) };
    }

    /*
     * Anything else — a Prisma error, a provider SDK throw, a TypeError — is
     * deliberately flattened. The detail lives in the log, not in the response.
     */
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'خطای غیرمنتظره‌ای رخ داد. لطفاً دوباره تلاش کنید.',
    };
  }
}

function defaultCodeFor(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_ERROR';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHENTICATED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    case HttpStatus.REQUEST_TIMEOUT:
      return 'REQUEST_TIMEOUT';
    case HttpStatus.BAD_GATEWAY:
    case HttpStatus.SERVICE_UNAVAILABLE:
    case HttpStatus.GATEWAY_TIMEOUT:
      return 'SERVICE_UNAVAILABLE';
    default:
      return 'INTERNAL_ERROR';
  }
}

function defaultMessageFor(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'اطلاعات ارسال‌شده معتبر نیست.';
    case HttpStatus.UNAUTHORIZED:
      return 'برای ادامه باید وارد شوید.';
    case HttpStatus.FORBIDDEN:
      return 'دسترسی لازم را ندارید.';
    case HttpStatus.NOT_FOUND:
      return 'مورد درخواستی یافت نشد.';
    case HttpStatus.CONFLICT:
      return 'این درخواست با وضعیت فعلی سازگار نیست.';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید.';
    case HttpStatus.REQUEST_TIMEOUT:
      return 'پردازش درخواست بیش از حد طول کشید. لطفاً دوباره تلاش کنید.';
    case HttpStatus.BAD_GATEWAY:
    case HttpStatus.SERVICE_UNAVAILABLE:
    case HttpStatus.GATEWAY_TIMEOUT:
      return 'سرویس موقتاً در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.';
    default:
      return 'خطای غیرمنتظره‌ای رخ داد. لطفاً دوباره تلاش کنید.';
  }
}
