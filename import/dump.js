// Maintenance CLI for destructive / bulk DB operations.
//
// Previously this file required editing `run()` to un-comment the desired
// operation before running — an easy way to fire the wrong (destructive)
// command. It's now a named-subcommand CLI with a yes/no confirmation on
// every destructive op, and each confirmation prints the target database so
// you can't truncate the wrong one.
//
// Usage:
//   node import/dump.js <command> [args]
//
// Commands:
//   truncate-all                 Truncate EVERY table (pairs, tokens,
//                                thresholds, duplicates, staging). Irreversible.
//   truncate-staging             Truncate only the PairStaging table.
//   delete-pairs <chain> <dex>   Delete all pairs (+ their duplicate links and
//                                staging rows) for one (chain, dex).
//   delete-tokens <chain>        Delete all tokens (+ their duplicate-symbol
//                                links) for one chain.
//   set-created-at               Backfill createdAt for legacy rows where it is 0.

const readline = require("readline");

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

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

const truncateAll = async () => {
    const tablenames = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public'`;

    const tables = tablenames
        .map(({ tablename }) => tablename)
        .filter((name) => name !== "_prisma_migrations")
        .map((name) => `"public"."${name}"`)
        .join(", ");

    console.log("Truncating", tables);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);
};

const truncateStaging = async () => {
    console.log("Truncating PairStaging");
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "public"."PairStaging" CASCADE;`);
};

const deleteFromPairs = async (chain, dex) => {
    const pairsToDel = await prisma.pair.findMany({ where: { chain, dex } });

    for (const p of pairsToDel) {
        console.log("delete pair", p.id);
        await prisma.duplicatePairs.deleteMany({
            where: { OR: [{ originalPairId: p.id }, { duplicatePairId: p.id }] },
        });
        await prisma.pair.delete({ where: { id: p.id } });
    }

    await prisma.pairStaging.deleteMany({ where: { chain, dex } });
};

const deleteTokens = async (chain) => {
    const tokensToDel = await prisma.token.findMany({ where: { chain } });

    for (const t of tokensToDel) {
        console.log("delete token", t.id);
        await prisma.duplicateTokenSymbols.deleteMany({
            where: { OR: [{ originalTokenId: t.id }, { duplicateTokenId: t.id }] },
        });
        await prisma.token.delete({ where: { id: t.id } });
    }
};

const setCreatedAt = async () => {
    const now = Math.floor(Date.now() / 1000);
    const tokens = await prisma.token.updateMany({ where: { createdAt: 0 }, data: { createdAt: now } });
    const pairs = await prisma.pair.updateMany({ where: { createdAt: 0 }, data: { createdAt: now } });
    console.log(`Backfilled createdAt on ${tokens.count} tokens, ${pairs.count} pairs`);
};

const usage = () => {
    console.log(`Usage: node import/dump.js <command> [args]

Commands:
  truncate-all                 Truncate EVERY table. Irreversible.
  truncate-staging             Truncate only PairStaging.
  delete-pairs <chain> <dex>   Delete pairs for one (chain, dex).
  delete-tokens <chain>        Delete tokens for one chain.
  set-created-at               Backfill createdAt for legacy rows (createdAt = 0).`);
};

const main = async () => {
    const [cmd, ...args] = process.argv.slice(2);
    const db = targetDb();

    switch (cmd) {
        case "truncate-all": {
            if (!(await confirm(`Truncate ALL tables in "${db}"? This is irreversible.`))) {
                console.log("Aborted.");
                return;
            }
            await truncateAll();
            console.log("Done.");
            break;
        }
        case "truncate-staging": {
            if (!(await confirm(`Truncate PairStaging in "${db}"?`))) {
                console.log("Aborted.");
                return;
            }
            await truncateStaging();
            console.log("Done.");
            break;
        }
        case "delete-pairs": {
            const [chain, dex] = args;
            if (!chain || !dex) {
                console.error("delete-pairs requires <chain> <dex>");
                process.exitCode = 1;
                return;
            }
            if (!(await confirm(`Delete all ${chain}/${dex} pairs in "${db}"?`))) {
                console.log("Aborted.");
                return;
            }
            await deleteFromPairs(chain, dex);
            console.log("Done.");
            break;
        }
        case "delete-tokens": {
            const [chain] = args;
            if (!chain) {
                console.error("delete-tokens requires <chain>");
                process.exitCode = 1;
                return;
            }
            if (!(await confirm(`Delete all ${chain} tokens in "${db}"?`))) {
                console.log("Aborted.");
                return;
            }
            await deleteTokens(chain);
            console.log("Done.");
            break;
        }
        case "set-created-at": {
            await setCreatedAt();
            break;
        }
        default:
            usage();
            break;
    }
};

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
