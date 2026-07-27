import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { Response } from "express";
import { randomUUID } from "crypto";

/**
 * Global error handler. Classifies errors as transient vs permanent (Part E7)
 * for logging purposes and always returns a stable JSON shape with a trace_id
 * so a support/debug query can find the matching log line.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("ExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const errorClass = status >= 500 ? "transient" : "permanent";
    const traceId = request.headers["x-trace-id"] ?? randomUUID();

    const message = isHttpException
      ? exception.getResponse()
      : "Internal server error";

    this.logger.error(
      JSON.stringify({
        traceId,
        errorClass,
        path: request.url,
        method: request.method,
        message: isHttpException ? message : (exception as Error)?.message,
      }),
    );

    response.status(status).json({
      statusCode: status,
      traceId,
      message,
    });
  }
}
