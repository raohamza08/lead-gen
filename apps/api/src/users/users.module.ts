import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { EmailModule } from "../email/email.module";
import { OrganizationModule } from "../organization/organization.module";

@Module({
  imports: [EmailModule, OrganizationModule],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
