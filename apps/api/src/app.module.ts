import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { PrismaModule } from "./common/prisma/prisma.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { PiiRedactionInterceptor } from "./common/interceptors/pii-redaction.interceptor";
import { AuditLogInterceptor } from "./common/interceptors/audit-log.interceptor";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { NicheFiltersModule } from "./niche-filters/niche-filters.module";
import { LeadsModule } from "./leads/leads.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { EmailModule } from "./email/email.module";
import { SyncModule } from "./sync/sync.module";
import { SequencerModule } from "./sequencer/sequencer.module";
import { WebhooksModule } from "./webhooks/webhooks.module";

@Module({
  imports: [
    // Monorepo keeps a single .env at the repo root (README setup step 1);
    // npm workspace scripts run with cwd=apps/api, so @nestjs/config's default
    // ".env in cwd" lookup would miss it. Root path first, local .env (if any)
    // as an override for per-service tweaks.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ["../../.env", ".env"] }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    NicheFiltersModule,
    LeadsModule,
    AnalyticsModule,
    EmailModule,
    SyncModule,
    SequencerModule,
    WebhooksModule,
  ],
  providers: [
    { provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, transform: true }) },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: PiiRedactionInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
})
export class AppModule {}
