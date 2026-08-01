import { PrismaClient } from '@/generated/prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaPg } from '@prisma/adapter-pg'

const url = process.env.DATABASE_URL!
const adapter =
  process.env.DATABASE_ADAPTER === 'pg'
    ? new PrismaPg({ connectionString: url })
    : new PrismaNeon({ connectionString: url })

const globalForPrisma = global as unknown as {
  prisma: PrismaClient
}

const prisma = globalForPrisma.prisma || new PrismaClient({ adapter })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma
