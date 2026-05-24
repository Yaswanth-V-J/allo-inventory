import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const updatedReservation = await prisma.$transaction(async (tx) => {
      // 1. Fetch reservation
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

      // 2. If already released or confirmed, do nothing and return it as-is
      if (reservation.status !== "PENDING") {
        return reservation;
      }

      // 3. Decrement reserved stock back in the warehouse inventory
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

      // 4. Mark reservation as RELEASED
      const released = await tx.reservation.update({
        where: { id },
        data: { status: "RELEASED" },
        include: {
          product: true,
          warehouse: true,
        },
      });

      return released;
    });

    return NextResponse.json(updatedReservation);

  } catch (error: any) {
    console.error("Error in POST /api/reservations/[id]/release:", error);

    if (error.message === "RESERVATION_NOT_FOUND") {
      return NextResponse.json(
        { error: "Reservation not found." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error: " + error.message },
      { status: 500 }
    );
  }
}
