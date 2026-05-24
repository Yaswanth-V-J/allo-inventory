import { prisma } from "./prisma";

/**
 * Reusable helper to clean up expired reservations.
 * Finds all expired PENDING reservations, decrements reserved stock from their warehouses, and marks them RELEASED.
 * Can be passed an optional transaction client to run inside an existing Postgres transaction.
 */
export async function cleanupExpiredReservations(tx?: any) {
  const db = tx || prisma;
  const now = new Date();

  // Run the cleanup process
  const executeCleanup = async (transactionDb: any) => {
    // 1. Fetch expired PENDING reservations and lock them to avoid concurrent double-processing
    // Using PostgreSQL's row-level locking ensures that if two requests execute cleanup at the same time,
    // they serialize, and the second request will skip/see the updated status.
    const expiredReservations = await transactionDb.$queryRaw<
      Array<{
        id: string;
        productId: string;
        warehouseId: string;
        quantity: number;
      }>
    >`
      SELECT id, "productId", "warehouseId", quantity 
      FROM "Reservation" 
      WHERE status = 'PENDING' AND "expiresAt" <= ${now}
      FOR UPDATE
    `;

    if (!expiredReservations || expiredReservations.length === 0) {
      return 0;
    }

    console.log(`[Lazy Cleanup] Found ${expiredReservations.length} expired reservations.`);

    for (const reservation of expiredReservations) {
      // 2. Mark the reservation as RELEASED
      await transactionDb.reservation.update({
        where: { id: reservation.id },
        data: { status: "RELEASED" },
      });

      // 3. Decrement the reservedStock in the corresponding Inventory record
      await transactionDb.inventory.update({
        where: {
          productId_warehouseId: {
            productId: reservation.productId,
            warehouseId: reservation.warehouseId,
          },
        },
        data: {
          reservedStock: {
            decrement: reservation.quantity,
          },
        },
      });

      console.log(
        `[Lazy Cleanup] Released reservation ${reservation.id} - Freed ${reservation.quantity} items for Product ${reservation.productId} in Warehouse ${reservation.warehouseId}`
      );
    }

    return expiredReservations.length;
  };

  // If already inside an active transaction, use it. Otherwise, create a new one.
  if (tx) {
    return await executeCleanup(tx);
  } else {
    return await prisma.$transaction(async (t) => {
      return await executeCleanup(t);
    }, {
      isolationLevel: "ReadCommitted", // default, perfectly suited for row-locking
    });
  }
}
