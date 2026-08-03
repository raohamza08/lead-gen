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

    // exception.getResponse() is not a string. Nest's built-in exceptions
    // (ConflictException("text"), NotFoundException("text"), etc.) wrap a
    // string argument into { statusCode, message, error }, and class-validator's
    // BadRequestException puts an array of per-field messages in `message`.
    // Putting that raw object straight into this filter's own `message` field
    // double-nested it — the client received `{ message: { message: "..." } }`
    // and every call site reading `body.message` got an object, which
    // `new Error(...)` stringifies to the useless "[object Object]". Flatten
    // it here once so every caller gets a plain string.
    const rawResponse = isHttpException ? exception.getResponse() : null;
    let message: string;
    if (!isHttpException) {
      message = "Internal server error";
    } else if (typeof rawResponse === "string") {
      message = rawResponse;
    } else if (rawResponse && typeof rawResponse === "object" && "message" in rawResponse) {
      const inner = (rawResponse as { message: unknown }).message;
      message = Array.isArray(inner) ? inner.join(", ") : String(inner);
    } else {
      message = "Request failed";
    }

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
