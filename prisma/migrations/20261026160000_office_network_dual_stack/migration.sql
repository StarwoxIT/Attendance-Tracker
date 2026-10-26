-- AlterTable
ALTER TABLE "office_networks" ADD COLUMN     "currentPublicIpv6" TEXT,
ADD COLUMN     "ipv4VerifiedAt" TIMESTAMP(3),
ADD COLUMN     "ipv6VerifiedAt" TIMESTAMP(3);

-- Data: currentPublicIp held whichever family was seen last. Move IPv6 values to
-- their own column and carry the verification time over to the matching family.
UPDATE "office_networks"
SET "currentPublicIpv6" = "currentPublicIp",
    "ipv6VerifiedAt" = "lastVerifiedAt",
    "currentPublicIp" = NULL
WHERE "currentPublicIp" LIKE '%:%';

UPDATE "office_networks"
SET "ipv4VerifiedAt" = "lastVerifiedAt"
WHERE "currentPublicIp" IS NOT NULL;
