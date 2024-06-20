const {PrismaClient} = require('@prisma/client');
const prisma = new PrismaClient();


// const run = async () => {
//     const tablenames = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public'`
//
//     const tables = tablenames
//         .map(({ tablename }) => tablename)
//         .filter((name) => name !== '_prisma_migrations')
//         .map((name) => `"public"."${name}"`)
//         .join(', ')
//
//     console.log("Truncating", tables)
//
//     try {
//         await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`)
//     } catch (error) {
//         console.log({ error })
//     }
//
//     return "Done"
// }
//
// run().then(console.log)
