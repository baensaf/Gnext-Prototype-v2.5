import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

export interface FieldError {
  field: string;
  code: string;
  messageKey?: string;
  message?: string;
}

export interface ProblemDetailsResponse {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  instance: string;
  correlationId: string;
  fieldErrors?: FieldError[];
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const correlationId = (request.headers['x-correlation-id'] as string) || (request as any).correlationId || '00000000-0000-0000-0000-000000000000';
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let title = 'An unexpected error occurred';
    let detail = 'An internal server error occurred while processing the request.';
    let type = 'https://gnext.local/problems/internal';
    let fieldErrors: FieldError[] | undefined = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resObj = exception.getResponse() as any;

      if (typeof resObj === 'string') {
        detail = resObj;
      } else if (typeof resObj === 'object' && resObj !== null) {
        code = resObj.code || code;
        title = resObj.title || exception.message || title;
        detail = resObj.detail || resObj.message || detail;
        type = resObj.type || type;

        if (Array.isArray(resObj.message)) {
          fieldErrors = resObj.message.map((msg: any) => {
            if (typeof msg === 'string') {
              return { field: 'body', code: 'INVALID', message: msg };
            }
            return msg;
          });
          detail = 'Validation failed for one or more fields.';
          code = 'VALIDATION_FAILED';
          status = HttpStatus.BAD_REQUEST;
        } else if (resObj.fieldErrors) {
          fieldErrors = resObj.fieldErrors;
        }
      }
    } else if (exception instanceof Error) {
      detail = exception.message;
    }

    const problemDetails: ProblemDetailsResponse = {
      type,
      title,
      status,
      code,
      detail,
      instance: request.url,
      correlationId,
      ...(fieldErrors && { fieldErrors }),
    };

    response.status(status).json(problemDetails);
  }
}
