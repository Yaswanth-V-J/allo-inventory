import { PrismaClient } from "@prisma/client";

// Initialize a separate Prisma client for the script
const prisma = new PrismaClient({
  log: ["error"]
});

async function runDirectDbTest(productId: string, warehouseId: string) {
  console.log("\n=======================================================");
  console.log("RUNNING DIRECT DATABASE TRANSACTION CONCURRENCY TEST");
  console.log("=======================================================");
  console.log(`Target: Product ${productId} in Warehouse ${warehouseId}`);
  
  // 1. Reset target stock to exactly 1 available unit (Total: 1, Reserved: 0)
  console.log("\nResetting stock to 1 unit...");
  await prisma.inventory.update({
    where: {
      productId_warehouseId: { productId, warehouseId }
    },
    data: {
      totalStock: 1,
      reservedStock: 0
    }
  });

  const currentInventory = await prisma.inventory.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } }
  });
  console.log(`Current Stock Level: Total=${currentInventory?.totalStock}, Reserved=${currentInventory?.reservedStock}`);

  // 2. Spawn 5 concurrent transactions trying to reserve that 1 unit
  console.log("\nSpawning 5 concurrent database reservation transactions in parallel...");
  
  const reservationAttempts = Array.from({ length: 5 }).map((_, index) => {
    return (async () => {
      const attemptNum = index + 1;
      try {
        const result = await prisma.$transaction(async (tx) => {
          // Row-level lock the inventory item using SELECT FOR UPDATE
          const inventoryRows = await tx.$queryRaw<any[]>`
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

          if (availableStock < 1) {
            throw new Error("INSUFFICIENT_STOCK");
          }

          // Simulate slight network/processing delay inside the transaction
          // to increase likelihood of collision in ordinary code, proving locking works.
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 200 + 50));

          // Increment reservedStock
          await tx.inventory.update({
            where: {
              productId_warehouseId: { productId, warehouseId }
            },
            data: {
              reservedStock: { increment: 1 }
            }
          });

          // Create pending reservation
          const newReservation = await tx.reservation.create({
            data: {
              productId,
              warehouseId,
              quantity: 1,
              status: "PENDING",
              expiresAt: new Date(Date.now() + 10 * 60 * 1000)
            }
          });

          return { success: true, attempt: attemptNum, reservationId: newReservation.id };
        });
        return result;
      } catch (err: any) {
        return { success: false, attempt: attemptNum, error: err.message };
      }
    })();
  });

  const results = await Promise.all(reservationAttempts);

  console.log("\n================ TEST RESULTS =======================");
  let successfulAttempts = 0;
  let conflictedAttempts = 0;

  results.forEach((res) => {
    if (res.success) {
      successfulAttempts++;
      const successRes = res as { success: true; attempt: number; reservationId: string };
      console.log(`Attempt #${successRes.attempt}: SUCCESS - Reservation Created (${successRes.reservationId})`);
    } else {
      conflictedAttempts++;
      const errorRes = res as { success: false; attempt: number; error: string };
      console.log(`Attempt #${errorRes.attempt}: CONFLICT - Failed with error: ${errorRes.error}`);
    }
  });

  console.log("-----------------------------------------------------");
  console.log(`Summary: Total Successful = ${successfulAttempts} (Expected: 1)`);
  console.log(`Summary: Total Conflicted = ${conflictedAttempts} (Expected: 4)`);
  
  if (successfulAttempts === 1) {
    console.log("\n✅ SUCCESS: Row-level locking correctly serialized updates! No double-booking occurred.");
  } else {
    console.log("\n❌ FAILURE: Race condition detected! Multiple reservations went through.");
  }
}

async function runHttpTest(baseUrl: string) {
  console.log("\n=======================================================");
  console.log("RUNNING HTTP CONCURRENCY TEST");
  console.log("=======================================================");
  
  try {
    // 1. Fetch available products
    console.log(`Fetching products from ${baseUrl}/api/products ...`);
    const pRes = await fetch(`${baseUrl}/api/products`);
    if (!pRes.ok) {
      throw new Error(`Failed to fetch products: ${pRes.statusText}`);
    }
    const products = await pRes.json();
    if (products.length === 0) {
      throw new Error("No products found in DB to test. Seed the database first!");
    }

    // Target the first product with some stock
    const target = products.find((p: any) => p.availableStock > 0) || products[0];
    const { productId, warehouseId } = target;
    console.log(`Targeting product "${target.productName}" at warehouse "${target.warehouseName}" (Available: ${target.availableStock})`);

    // 2. Fire 10 concurrent requests to reserve 1 item each
    console.log("\nFiring 10 concurrent HTTP POST requests to API...");
    const requests = Array.from({ length: 10 }).map((_, index) => {
      const attemptNum = index + 1;
      return (async () => {
        try {
          const res = await fetch(`${baseUrl}/api/reservations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId, warehouseId, quantity: 1 })
          });
          const data = await res.json();
          return { status: res.status, attempt: attemptNum, data };
        } catch (err: any) {
          return { status: 500, attempt: attemptNum, error: err.message };
        }
      })();
    });

    const results = await Promise.all(requests);

    console.log("\n================ HTTP API RESULTS ===================");
    let successCount = 0;
    let conflictCount = 0;
    let otherCount = 0;

    results.forEach((res) => {
      if (res.status === 201) {
        successCount++;
        console.log(`Req #${res.attempt}: Status 201 CREATED - Reservation ID: ${res.data.id}`);
      } else if (res.status === 409) {
        conflictCount++;
        console.log(`Req #${res.attempt}: Status 409 CONFLICT - Message: ${res.data.error}`);
      } else {
        otherCount++;
        console.log(`Req #${res.attempt}: Status ${res.status} - Error: ${res.data?.error || res.error}`);
      }
    });

    console.log("-----------------------------------------------------");
    console.log(`HTTP Summary: Successes (201) = ${successCount}`);
    console.log(`HTTP Summary: Conflicts (409) = ${conflictCount}`);
    console.log(`HTTP Summary: Other (500/404) = ${otherCount}`);
    console.log("=====================================================");

  } catch (error: any) {
    console.error("HTTP Concurrency Test failed to run:", error.message);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isHttp = args.includes("--http");

  if (isHttp) {
    const baseUrl = process.env.BASE_URL || "http://localhost:3000";
    await runHttpTest(baseUrl);
  } else {
    // Direct DB tests require matching items in DB
    try {
      const product = await prisma.product.findFirst();
      const warehouse = await prisma.warehouse.findFirst();
      
      if (!product || !warehouse) {
        console.error("❌ ERROR: Database tables are empty. Seed the database first with `npx prisma db seed`!");
        process.exit(1);
      }

      await runDirectDbTest(product.id, warehouse.id);
    } catch (err: any) {
      console.error("❌ ERROR: Failed to run DB Concurrency Test: ", err.message);
      console.log("\nMake sure your DATABASE_URL in .env is configured and migrations are run.");
    } finally {
      await prisma.$disconnect();
    }
  }
}

main();
