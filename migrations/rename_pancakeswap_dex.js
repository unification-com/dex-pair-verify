// One-off data migration: rename the BSC PancakeSwap v3 DEX id from the
// legacy kebab-with-suffix form `pancakeswap-v3-bsc` to the underscore form
// `bsc_pancakeswap_v3`, so dex-pair-verify's DEX ids match go-ooo's module-dir
// naming and the `cleanseDexId()` export shim can be dropped.
//
// The project uses `prisma db push` (no migration history), so this is a
// standalone runnable rather than a tracked Prisma migration. It is
// confirm-gated and prints the target database.
//
// Usage (production): set POSTGRES_PRISMA_URL to the prod DB, then
//   node migrations/rename_pancakeswap_dex.js
//
// The `dex` column is a free String on Pair / PairStaging / DuplicatePairs /
// Threshold; all four are updated inside a single transaction.

const readline = require("readline");

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const OLD_DEX = "pancakeswap-v3-bsc";
const NEW_DEX = "bsc_pancakeswap_v3";

const targetDb = () => {
    const url = process.env.POSTGRES_PRISMA_URL || "";
    const match = url.match(/\/([^/?]+)(\?|$)/);
    return match ? match[1] : "(unknown)";
};

const confirm = (question) =>
    new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`${question} (type "yes" to proceed) `, (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() === "yes");
        });
    });

const main = async () => {
    const db = targetDb();

    const counts = {
        Pair: await prisma.pair.count({ where: { dex: OLD_DEX } }),
        PairStaging: await prisma.pairStaging.count({ where: { dex: OLD_DEX } }),
        DuplicatePairs: await prisma.duplicatePairs.count({ where: { dex: OLD_DEX } }),
        Threshold: await prisma.threshold.count({ where: { dex: OLD_DEX } }),
    };

    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    console.log(`Target DB: "${db}"`);
    console.log(`Rows with dex = "${OLD_DEX}":`);
    for (const [table, n] of Object.entries(counts)) {
        console.log(`  ${table.padEnd(16)} ${n}`);
    }

    if (total === 0) {
        console.log("Nothing to migrate. Done.");
        return;
    }

    if (!(await confirm(`Rename dex "${OLD_DEX}" → "${NEW_DEX}" on ${total} rows in "${db}"?`))) {
        console.log("Aborted.");
        return;
    }

    const result = await prisma.$transaction([
        prisma.pair.updateMany({ where: { dex: OLD_DEX }, data: { dex: NEW_DEX } }),
        prisma.pairStaging.updateMany({ where: { dex: OLD_DEX }, data: { dex: NEW_DEX } }),
        prisma.duplicatePairs.updateMany({ where: { dex: OLD_DEX }, data: { dex: NEW_DEX } }),
        prisma.threshold.updateMany({ where: { dex: OLD_DEX }, data: { dex: NEW_DEX } }),
    ]);

    const [pairs, staging, dupes, thresholds] = result;
    console.log("Updated:");
    console.log(`  Pair            ${pairs.count}`);
    console.log(`  PairStaging     ${staging.count}`);
    console.log(`  DuplicatePairs  ${dupes.count}`);
    console.log(`  Threshold       ${thresholds.count}`);
    console.log("Done.");
};

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
