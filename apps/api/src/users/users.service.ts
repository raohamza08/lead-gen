import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
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
    try {
      return await this.prisma.user.create({
        data: { orgId, email: input.email, name: input.name, passwordHash, role: input.role },
        select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
      });
    } catch (err) {
      // `email` is globally unique (Part A2), not just per-org, so this is the
      // one create path where a plain constraint violation is an expected,
      // actionable outcome rather than a bug.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException(`A user with email ${input.email} already exists`);
      }
      throw err;
    }
  }

  setActive(id: string, active: boolean) {
    return this.prisma.user.update({ where: { id }, data: { active } });
  }

  setRole(id: string, role: Role) {
    return this.prisma.user.update({ where: { id }, data: { role } });
  }
}
