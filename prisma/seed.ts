import { db } from "../src/lib/db";
import { initialSources, sourceUrl } from "../src/lib/domain";

async function main() {
  await db.$transaction(async tx => {
    await tx.appSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    for (const source of initialSources) {
      await tx.source.upsert({
        where: { platform_handle: { platform: source.platform, handle: source.handle } },
        create: { ...source, url: sourceUrl(source.platform, source.handle) },
        update: {},
      });
    }
  });
}
main().catch(() => { console.error("Seed failed. Check database connectivity and migrations."); process.exitCode = 1; }).finally(() => db.$disconnect());
