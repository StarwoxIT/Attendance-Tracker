/**
 * Deployment seed: creates the first SUPER_ADMIN (if SEED_ADMIN_EMAIL/PASSWORD are
 * set) and default settings rows. Safe to re-run, and safe to run on every deploy —
 * every step is idempotent (upsert), and an existing user with that email is left
 * untouched rather than overwritten. Runs automatically as part of the `migrate`
 * container's startup command (see Dockerfile) in the self-hosted/Docker setup.
 *
 * SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD are optional here: unset means "don't seed
 * an admin this run" (e.g. after the first deploy, once an admin already exists),
 * not a misconfiguration. Intentionally has no hard-coded fallback credentials —
 * see docs/DEPLOYMENT_VERCEL.md.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME ?? "Super Admin";

  if (!email && !password) {
    console.log("SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD not set — skipping super admin seed.");
  } else if (!email || !password) {
    throw new Error("SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must both be set (or both left unset).");
  } else {
    if (password.length < 10) {
      throw new Error("SEED_ADMIN_PASSWORD must be at least 10 characters.");
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      console.log(`Super admin already exists, skipping: ${existing.email}`);
    } else {
      const admin = await prisma.user.create({
        data: { email: email.toLowerCase(), passwordHash, fullName: name, role: "SUPER_ADMIN" },
      });
      console.log(`Super admin created: ${admin.email}`);
    }
  }

  await prisma.companySettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  console.log("Default company settings ready.");

  await prisma.attendanceSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  console.log("Default attendance settings ready (Africa/Lagos, 09:00 start, 15min grace, QR + Network mode).");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
