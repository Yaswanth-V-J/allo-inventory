# Multi-Warehouse Inventory Reservation System

A production-grade, highly concurrent stock reservation system built with **Next.js 16 (App Router)**, **TypeScript**, **Prisma ORM**, and **PostgreSQL (Supabase compatible)**. This system guarantees zero overselling through strict database-level transaction isolation and row-level locking.

---

## 🌟 Architecture & Concurrency Strategy

In high-traffic e-commerce systems, multiple customers often attempt to purchase the same inventory unit simultaneously. Standard atomic decrements alone do not suffice during multi-step checkout processes (where payment takes several minutes). 

### The Problem
* **Decrementing stock only after payment:** Leads to overselling (race conditions where 5 users see 1 item in stock, click purchase, all payments succeed, and only 1 can be fulfilled).
* **Decrementing stock immediately in cart:** Leads to stock hoarding and cart abandonment (items locked indefinitely by abandoned sessions).

### The Solution: Row-Level Locking (`SELECT FOR UPDATE`)
To solve this, this system implements a temporary **10-minute hold reservation**. When a user requests a hold, the request executes inside a PostgreSQL transaction (`prisma.$transaction`) executing a row-level lock:

```sql
SELECT id, "productId", "warehouseId", "totalStock", "reservedStock"
FROM "Inventory"
WHERE "productId" = $1 AND "warehouseId" = $2
FOR UPDATE;
```

#### Why this was chosen:
* **Strict Serialization:** The `FOR UPDATE` clause instructs PostgreSQL to lock the matched `Inventory` rows. Any concurrent reservation request targeting the exact same product and warehouse will **block** (wait in line) until the active transaction either commits (`201 Created`) or rolls back.
* **Concurrency-Safe Assessment:** Because the lock blocks concurrent reads/writes on that specific row, stock checks are guaranteed to evaluate sequential, accurate states. This ensures that if only 1 item is available, **exactly one reservation succeeds** and the other blocked transaction resumes, sees `availableStock < quantity`, and terminates with a `409 Conflict`.
* **Precision Scope:** Row locking locks *only* the specific `Inventory` row (matching the product/warehouse combination) rather than locking the entire table. This guarantees high throughput for other product lines or warehouse combinations.

---

## ⏱️ Reservation Expiry & Lazy Cleanup

Expired `PENDING` reservations must release locked stock back into the inventory without locking database operations.

### Lazy Expiration Helper (`cleanupExpiredReservations()`)
This system uses a **lazy cleanup** model. Instead of relying on a highly complex active daemon that frequently polls the database, the `cleanupExpiredReservations()` helper is automatically executed as an inline database task *before*:
1. Stock reads in `/api/products`
2. Reservation attempts in `POST /api/reservations`
3. Single reservation detail lookups in `/api/reservations/[id]`

#### Expiry Concurrency Safety:
When executing `cleanupExpiredReservations()`, the query uses PostgreSQL's row locks:
```sql
SELECT id, "productId", "warehouseId", quantity 
FROM "Reservation" 
WHERE status = 'PENDING' AND "expiresAt" <= NOW()
FOR UPDATE;
```
If two requests execute lazy cleanup concurrently, they serialize. The first transaction updates the reservation status to `RELEASED` and decrements `reservedStock` in `Inventory`. The second transaction then receives the lock, evaluates the status (now `RELEASED`), and gracefully ignores it, preventing duplicate stock rollbacks.

### Future-Proof Architecture
The cleanup logic is encapsulated as a standalone utility function:
`export async function cleanupExpiredReservations(tx?: PrismaClient)`
This design accepts an optional transaction client (`tx`), allowing it to be easily integrated into:
* **Vercel Cron / Serverless Cron:** A cron job firing a GET request to a secure cleanup endpoint every minute (`/api/cron/cleanup`).
* **Background Worker / BullMQ / Celery:** A background queue executing off-thread.

---

## 🛠️ Tech Stack
* **Framework:** Next.js 16.2 (App Router, Tailwind CSS, TypeScript, ESLint)
* **ORM:** Prisma v6.4
* **Database:** PostgreSQL (Supabase transaction pooler compatible)
* **Validation:** Zod

---

## 🚀 Setup & Installation

### 1. Clone & Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the project root directory. Use `.env.example` as a template:

```env
# PostgreSQL connection string with transaction pooler (port 6543 for Supabase)
DATABASE_URL="postgresql://postgres.[YOUR-PROJECT-ID]:[YOUR-PASSWORD]@[YOUR-POOLER-HOST]:6543/postgres?pgbouncer=true&connection_limit=1"

# Direct connection string for schema migrations (port 5432 for Supabase)
DIRECT_URL="postgresql://postgres.[YOUR-PROJECT-ID]:[YOUR-PASSWORD]@[YOUR-DIRECT-HOST]:5432/postgres"

# PORT (Optional)
PORT=3000
```

### 3. Generate Prisma Client & Run Migrations
Apply the database schema and compile the TypeScript Prisma client:
```bash
# Run schema migrations
npx prisma migrate dev --name init

# Generate Client bindings (automatically runs during install)
npx prisma generate
```

### 4. Seed the Database
Populate the database with default Products (*Running Shoes, Hoodie, T-Shirt*), Warehouses (*Chennai, Bangalore*), and initial stock levels:
```bash
npx prisma db seed
```

### 5. Run the Local Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🧪 Verification & Concurrency Testing

We have built an automated test suite under `src/scripts/test-concurrency.ts` to simulate high-load concurrency.

### Direct Database Transaction Test (Recommended)
This runs multiple database transactions in parallel against the database. It forces a deliberate network delay inside the transaction block to create overlap, proving that row-level locking serializes parallel updates correctly.

To run:
```bash
npx tsx src/scripts/test-concurrency.ts
```

### HTTP Concurrency Test
This fires 10 concurrent HTTP POST requests to a running Next.js instance for the last remaining item.

To run:
```bash
# Ensure local development server is running on http://localhost:3000
# Run the test
npx tsx src/scripts/test-concurrency.ts --http
```

Expected Result:
Exactly **1** request succeeds with `201 Created` and all other overlapping requests fail with `409 Conflict (Not enough stock available)`.

---

## 📈 Engineering Tradeoffs & Future Enhancements

### 1. Row-Level Locking (`SELECT FOR UPDATE`) vs. Optimistic Concurrency
* **Why Row Locking was chosen:** In high-contention e-commerce checkouts (like limited product drops), optimistic locking (which uses a version/timestamp field and retries on clash) causes high transaction rollbacks and slow client response times due to constant retries. Database row-level locking serializes threads efficiently, ensuring zero retries and predictable database behavior.
* **Tradeoff:** Row-level locks hold a database connection slot open for the duration of the transaction. If payment gates or external APIs were called *inside* the lock block, this could choke database connections. To prevent this, our transaction *only* performs database operations and executes within milliseconds.

### 2. Lazy Expiry Cleanup vs. Vercel Cron
* **Why Lazy Cleanup was chosen:** Fits perfectly into a serverless (Vercel) model without external schedulers. It ensures users always see accurate stock counts even if no daemon is running.
* **Improvement with more time:** Add a Vercel Cron Job configured via `vercel.json` to call an API endpoint (`/api/cron/cleanup`) every minute. This prevents stock from remaining unreleased if the site receives no traffic for long periods of time.

### 3. Redis / Upstash Cache
* **Why it was omitted:** Avoids double-sources-of-truth and cache-invalidation bugs.
* **Improvement with more time:** For heavily read-heavy e-commerce pages, product stock listings should be cached in Redis with a TTL of 1 second. True inventory holds must still fall back to PostgreSQL row-level locks for safety.
