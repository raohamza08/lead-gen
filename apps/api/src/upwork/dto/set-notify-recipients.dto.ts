import { IsArray, IsBoolean, IsOptional, IsString } from "class-validator";

export class SetNotifyRecipientsDto {
  @IsArray() @IsString({ each: true }) userIds!: string[];
  @IsOptional() @IsBoolean() notifyNow?: boolean;
}
