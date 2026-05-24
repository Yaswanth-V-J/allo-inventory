import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cleanupExpiredReservations } from "@/lib/reservations";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 1. Run lazy cleanup before reading stock
    await cleanupExpiredReservations();

    // 2. Fetch inventories with products and warehouses
    const inventories = await prisma.inventory.findMany({
      include: {
        product: true,
        warehouse: true,
      },
      orderBy: [
        { product: { name: "asc" } },
        { warehouse: { name: "asc" } },
      ],
    });

    // 3. Format response according to requirements
    const result = inventories.map((inv) => ({
      productId: inv.productId,
      productName: inv.product.name,
      warehouseId: inv.warehouseId,
      warehouseName: inv.warehouse.name,
      totalStock: inv.totalStock,
      reservedStock: inv.reservedStock,
      availableStock: inv.totalStock - inv.reservedStock,
    }));

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error: any) {
    console.error("Error in GET /api/products:", error);
    return NextResponse.json(
      { error: "Failed to fetch products: " + error.message },
      { status: 500 }
    );
  }
}
