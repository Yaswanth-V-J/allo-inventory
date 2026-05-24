import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Cleaning up database...");
  await prisma.reservation.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.product.deleteMany();
  await prisma.warehouse.deleteMany();

  console.log("Seeding Warehouses...");
  const chennai = await prisma.warehouse.create({
    data: { name: "Chennai Warehouse" },
  });
  const bangalore = await prisma.warehouse.create({
    data: { name: "Bangalore Warehouse" },
  });

  console.log("Seeding Products...");
  const runningShoes = await prisma.product.create({
    data: { name: "Running Shoes" },
  });
  const hoodie = await prisma.product.create({
    data: { name: "Hoodie" },
  });
  const tShirt = await prisma.product.create({
    data: { name: "T-Shirt" },
  });

  console.log("Seeding Inventory levels...");
  // Running Shoes
  await prisma.inventory.create({
    data: {
      productId: runningShoes.id,
      warehouseId: chennai.id,
      totalStock: 20,
      reservedStock: 0,
    },
  });
  await prisma.inventory.create({
    data: {
      productId: runningShoes.id,
      warehouseId: bangalore.id,
      totalStock: 10,
      reservedStock: 0,
    },
  });

  // Hoodie
  await prisma.inventory.create({
    data: {
      productId: hoodie.id,
      warehouseId: chennai.id,
      totalStock: 15,
      reservedStock: 0,
    },
  });
  await prisma.inventory.create({
    data: {
      productId: hoodie.id,
      warehouseId: bangalore.id,
      totalStock: 5,
      reservedStock: 0,
    },
  });

  // T-Shirt
  await prisma.inventory.create({
    data: {
      productId: tShirt.id,
      warehouseId: chennai.id,
      totalStock: 30,
      reservedStock: 0,
    },
  });
  await prisma.inventory.create({
    data: {
      productId: tShirt.id,
      warehouseId: bangalore.id,
      totalStock: 25,
      reservedStock: 0,
    },
  });

  console.log("Database seeded successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
