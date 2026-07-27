import { Injectable } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../common/prisma/prisma.service";
import { Role } from "@leadgen/types";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAllForOrg(orgId: string) {
    return this.prisma.user.findMany({
      where: { orgId },
      select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async create(orgId: string, input: { email: string; name: string; password: string; role: Role }) {
    const passwordHash = await bcrypt.hash(input.password, 12);
    return this.prisma.user.create({
      data: { orgId, email: input.email, name: input.name, passwordHash, role: input.role },
      select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
    });
  }

  setActive(id: string, active: boolean) {
    return this.prisma.user.update({ where: { id }, data: { active } });
  }

  setRole(id: string, role: Role) {
    return this.prisma.user.update({ where: { id }, data: { role } });
  }
}
