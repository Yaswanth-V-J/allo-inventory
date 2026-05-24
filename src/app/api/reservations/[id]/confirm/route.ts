import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Run within a PostgreSQL transaction to ensure consistency
    const updatedReservation = await prisma.$transaction(async (tx) => {
      // 1. Fetch the reservation
      const reservation = await tx.reservation.findUnique({
        where: { id },
        include: {
          product: true,
          warehouse: true,
        },
      });

      if (!reservation) {
        throw new Error("RESERVATION_NOT_FOUND");
      }

      // 2. Check if expired (expiresAt <= current time)
      const now = new Date();
      const isExpired = reservation.expiresAt <= now;

      if (isExpired || reservation.status !== "PENDING") {
        // If it's expired and still marked as PENDING, release it to free up stock
        if (reservation.status === "PENDING") {
          await tx.reservation.update({
            where: { id },
            data: { status: "RELEASED" },
          });

          await tx.inventory.update({
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
        }
        throw new Error("RESERVATION_EXPIRED");
      }

      // 3. Perform permanent stock deduction
      // Decrement both totalStock and reservedStock, completing the sale.
      await tx.inventory.update({
        where: {
          productId_warehouseId: {
            productId: reservation.productId,
            warehouseId: reservation.warehouseId,
          },
        },
        data: {
          totalStock: {
            decrement: reservation.quantity,
          },
          reservedStock: {
            decrement: reservation.quantity,
          },
        },
      });

      // 4. Mark reservation as CONFIRMED
      const confirmed = await tx.reservation.update({
        where: { id },
        data: { status: "CONFIRMED" },
        include: {
          product: true,
          warehouse: true,
        },
      });

      return confirmed;
    });

    return NextResponse.json(updatedReservation);

  } catch (error: any) {
    console.error(`Error in POST /api/reservations/${error.message}:`, error);

    if (error.message === "RESERVATION_NOT_FOUND") {
      return NextResponse.json(
        { error: "Reservation not found." },
        { status: 404 }
      );
    }
    if (error.message === "RESERVATION_EXPIRED") {
      return NextResponse.json(
        { error: "Reservation expired" },
        { status: 410 } // 410 Gone
      );
    }

    return NextResponse.json(
      { error: "Internal server error: " + error.message },
      { status: 500 }
    );
  }
}
