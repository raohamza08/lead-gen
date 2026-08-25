import { Controller, Get, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { RequiresModule } from "../common/decorators/requires-module.decorator";

/**
 * Proxies the AI workers' agent roster for the dashboard's "complete list of
 * agents" view. The registry that actually knows every agent — name,
 * responsibility, requires/provides, which pipeline it belongs to — lives in
 * Python (`agents/registry.py`), not here. Re-deriving it in TypeScript would
 * mean two lists to keep in sync; the dashboard never talks to the AI workers
 * directly, so this is a thin pass-through instead.
 */
@Controller("agents")
export class AgentsController {
  constructor(private readonly config: ConfigService) {}

  @Get("fleet")
  @UseGuards(JwtAuthGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  async fleet() {
    const aiWorkersUrl = this.config.get<string>("AI_WORKERS_URL", "http://localhost:8000");
    try {
      const res = await fetch(`${aiWorkersUrl}/agents`);
      if (!res.ok) throw new Error(`worker responded ${res.status}`);
      return res.json();
    } catch (err) {
      throw new ServiceUnavailableException(
        `Could not reach the AI workers for the agent roster: ${(err as Error).message}`,
      );
    }
  }
}
