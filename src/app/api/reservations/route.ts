import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cleanupExpiredReservations } from "@/lib/reservations";

// Schema for request validation
const reserveRequestSchema = z.object({
  productId: z.string().cuid({ message: "Invalid product ID format." }),
  warehouseId: z.string().cuid({ message: "Invalid warehouse ID format." }),
  quantity: z.number().int().positive().default(1),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // 1. Validate request body
    const validation = reserveRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const { productId, warehouseId, quantity } = validation.data;

    // 2. Execute reservation inside a PostgreSQL Transaction with Row-Level Locking
    const reservation = await prisma.$transaction(async (tx) => {
      // 2a. Run lazy expiration cleanup inside this transaction context.
      // This immediately releases expired stock that could be reclaimed by this reservation request.
      await cleanupExpiredReservations(tx);

      // 2b. Lock the Inventory row for this product and warehouse using SELECT ... FOR UPDATE.
      // This will force other concurrent reservation requests for the same inventory item to wait
      // until this transaction commits or rolls back, avoiding overselling and race conditions.
      const inventoryRows = await tx.$queryRaw<
        Array<{
          id: string;
          productId: string;
          warehouseId: string;
          totalStock: number;
          reservedStock: number;
        }>
      >`
        SELECT id, "productId", "warehouseId", "totalStock", "reservedStock"
        FROM "Inventory"
        WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId}
        FOR UPDATE
      `;

      if (!inventoryRows || inventoryRows.length === 0) {
        throw new Error("INVENTORY_NOT_FOUND");
      }

      const inventory = inventoryRows[0];
      const availableStock = inventory.totalStock - inventory.reservedStock;

      // 2c. Check if available stock is sufficient
      if (availableStock < quantity) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      // 2d. Increment the reservedStock of the locked inventory row
      await tx.inventory.update({
        where: {
          productId_warehouseId: {
            productId,
            warehouseId,
          },
        },
        data: {
          reservedStock: {
            increment: quantity,
          },
        },
      });

      // 2e. Create the pending Reservation record (expires in 10 minutes)
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Now + 10 minutes
      const newReservation = await tx.reservation.create({
        data: {
          productId,
          warehouseId,
          quantity,
          status: "PENDING",
          expiresAt,
        },
        include: {
          product: true,
          warehouse: true,
        },
      });

      return newReservation;
    });

    return NextResponse.json(reservation, { status: 201 });

  } catch (error: any) {
    console.error("Error in POST /api/reservations:", error);

    // Handle expected business logic errors
    if (error.message === "INVENTORY_NOT_FOUND") {
      return NextResponse.json(
        { error: "Product is not stocked in this warehouse." },
        { status: 404 }
      );
    }
    if (error.message === "INSUFFICIENT_STOCK") {
      return NextResponse.json(
        { error: "Not enough stock available" },
        { status: 409 } // 409 Conflict
      );
    }

    return NextResponse.json(
      { error: "Internal server error: " + error.message },
      { status: 500 }
    );
  }
}
