import { prisma } from "@/lib/db/prisma";
import type { CompanySettings } from "@prisma/client";

const SINGLETON_ID = "singleton";

const DEFAULTS: Omit<CompanySettings, "id" | "updatedAt"> = {
  companyName: "Your Company",
  logoUrl: null,
  primaryColor: "#0F766E",
  secondaryColor: "#0EA5E9",
  accentColor: "#F59E0B",
  address: null,
  phone: null,
  email: null,
  website: null,
};

export async function getCompanySettings(): Promise<CompanySettings> {
  const existing = await prisma.companySettings.findUnique({ where: { id: SINGLETON_ID } });
  if (existing) return existing;
  // ON CONFLICT DO NOTHING — concurrent first requests (e.g. layout + page on a
  // fresh database) can both reach here; upsert with an empty update isn't
  // atomic and would fail one of them on the unique id.
  await prisma.companySettings.createMany({ data: [{ id: SINGLETON_ID, ...DEFAULTS }], skipDuplicates: true });
  return prisma.companySettings.findUniqueOrThrow({ where: { id: SINGLETON_ID } });
}

/**
 * Same as getCompanySettings, but falls back to in-memory defaults instead of
 * throwing if the database is unreachable. Used by the root layout, which
 * renders for every request (including error pages) — a DB hiccup there must
 * degrade to unbranded defaults, not take the whole site down.
 */
export async function getCompanySettingsSafe(): Promise<CompanySettings> {
  try {
    return await getCompanySettings();
  } catch {
    return { id: SINGLETON_ID, updatedAt: new Date(), ...DEFAULTS };
  }
}

export async function updateCompanySettings(
  data: Partial<Omit<CompanySettings, "id" | "updatedAt">>
): Promise<CompanySettings> {
  return prisma.companySettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...DEFAULTS, ...data },
    update: data,
  });
}
