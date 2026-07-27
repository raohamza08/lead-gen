import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Demo Organization",
      settings: { autoSendEnabled: false },
    },
    update: {},
  });

  const passwordHash = await bcrypt.hash("ChangeMe123!", 12);
  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    create: {
      orgId: org.id,
      email: "admin@example.com",
      name: "Admin",
      passwordHash,
      role: "ADMIN",
    },
    update: {},
  });

  await prisma.nicheFilter.upsert({
    where: { id: "00000000-0000-0000-0000-000000000010" },
    create: {
      id: "00000000-0000-0000-0000-000000000010",
      orgId: org.id,
      niche: "SaaS",
      subNiche: "B2B project management tools",
      countries: ["United States", "United Kingdom"],
      employeeCountMin: 11,
      employeeCountMax: 200,
      jobTitles: ["Founder", "CEO", "Head of Operations"],
      dailyTarget: 100,
      scheduleCron: "0 6 * * *",
      timezone: "UTC",
      active: true,
    },
    update: {},
  });

  console.log("Seeded demo organization, admin user (admin@example.com / ChangeMe123!), and one niche filter.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
