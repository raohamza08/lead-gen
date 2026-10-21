import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { JwtClaims } from "@leadgen/types";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AssistantService } from "./assistant.service";
import { SendAssistantMessageDto } from "./dto/send-assistant-message.dto";

@Controller("assistant")
@UseGuards(JwtAuthGuard)
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post("message")
  async message(@CurrentUser() user: JwtClaims, @Body() dto: SendAssistantMessageDto) {
    const reply = await this.assistant.answer(user, dto.message, dto.history);
    return { reply };
  }
}
