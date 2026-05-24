"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { subscribeInventoryUpdated } from "@/lib/inventory-events";
import { 
  Building2, 
  Package, 
  Layers, 
  Plus, 
  Minus, 
  Clock, 
  AlertTriangle, 
  ArrowRight,
  RefreshCw,
  CheckCircle2
} from "lucide-react";

interface ProductInventory {
  productId: string;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  totalStock: number;
  reservedStock: number;
  availableStock: number;
}

export default function ProductListingPage() {
  const router = useRouter();
  const [inventories, setInventories] = useState<ProductInventory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reservingId, setReservingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  // Track selected quantities for each combination
  // Key format: productId_warehouseId
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const fetchProducts = useCallback(async (showRefreshIndicator = false) => {
    if (showRefreshIndicator) setRefreshing(true);
    try {
      setErrorMsg(null);
      const res = await fetch(`/api/products?_=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error("Failed to fetch product inventory.");
      }
      const data: ProductInventory[] = await res.json();
      setInventories(data);
      
      // Initialize quantities to 1
      const initialQuants: Record<string, number> = {};
      data.forEach(item => {
        const key = `${item.productId}_${item.warehouseId}`;
        initialQuants[key] = 1;
      });
      setQuantities(prev => ({ ...initialQuants, ...prev }));
    } catch (err: any) {
      setErrorMsg(err.message || "An error occurred while fetching inventory.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Home may stay mounted in the client router cache; refetch when inventory changes elsewhere
  useEffect(() => {
    return subscribeInventoryUpdated(() => {
      fetchProducts();
    });
  }, [fetchProducts]);

  const handleQuantityChange = (productId: string, warehouseId: string, delta: number, maxStock: number) => {
    const key = `${productId}_${warehouseId}`;
    const current = quantities[key] || 1;
    const nextVal = current + delta;
    
    if (nextVal >= 1 && nextVal <= maxStock) {
      setQuantities(prev => ({
        ...prev,
        [key]: nextVal
      }));
    }
  };

  const handleReserve = async (productId: string, warehouseId: string, availableStock: number) => {
    const key = `${productId}_${warehouseId}`;
    const qty = quantities[key] || 1;
    const compoundId = `${productId}-${warehouseId}`;

    if (qty > availableStock) {
      setErrorMsg("Requested quantity exceeds available stock!");
      return;
    }

    setReservingId(compoundId);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, warehouseId, quantity: qty }),
      });

      if (response.status === 409) {
        setErrorMsg("Not enough stock available");
        // Refresh products to show updated stock
        await fetchProducts();
        return;
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Reservation failed.");
      }

      const reservation = await response.json();
      await fetchProducts();
      router.refresh();
      setSuccessMsg(`Reserved ${qty} items successfully! Redirecting...`);

      setTimeout(() => {
        router.push(`/reservation/${reservation.id}`);
      }, 1000);

    } catch (err: any) {
      setErrorMsg(err.message || "An unexpected error occurred.");
    } finally {
      setReservingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2.5 rounded-xl shadow-lg shadow-indigo-500/20 text-white">
              <Layers className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">ALLO Health Stock</h1>
              <p className="text-xs text-slate-400">Inventory & Checkout Reservation System</p>
            </div>
          </div>
          
          <button 
            onClick={() => fetchProducts(true)}
            disabled={loading || refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800/50 rounded-xl transition text-sm font-medium border border-slate-700/50 shadow-sm"
          >
            <RefreshCw className={`h-4 w-4 text-indigo-400 ${refreshing ? "animate-spin" : ""}`} />
            <span>{refreshing ? "Refreshing..." : "Refresh Stock"}</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
        
        {/* Error / Success Notifications */}
        {errorMsg && (
          <div className="mb-6 p-4 bg-rose-950/40 border border-rose-800/80 rounded-2xl flex items-start gap-3 text-rose-200 shadow-lg shadow-rose-950/10 animate-in fade-in slide-in-from-top-4 duration-300">
            <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-rose-300">Stock Conflict / Error</p>
              <p className="text-sm text-rose-200/90">{errorMsg}</p>
            </div>
          </div>
        )}

        {successMsg && (
          <div className="mb-6 p-4 bg-emerald-950/40 border border-emerald-800/80 rounded-2xl flex items-start gap-3 text-emerald-200 shadow-lg shadow-emerald-950/10 animate-in fade-in slide-in-from-top-4 duration-300">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-emerald-300">Success</p>
              <p className="text-sm text-emerald-200/90">{successMsg}</p>
            </div>
          </div>
        )}

        {/* Info Banner */}
        <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl p-6 mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-indigo-300 flex items-center gap-2">
              <Clock className="h-5 w-5 text-indigo-400" />
              Lazy Expiration Active
            </h2>
            <p className="text-sm text-slate-300 max-w-2xl leading-relaxed">
              Expired PENDING reservations (older than 10 minutes) are automatically swept and released back into available inventory whenever you load this list or request a reservation.
            </p>
          </div>
          <div className="text-xs font-semibold px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 rounded-lg self-start md:self-center">
            Pg Transaction Lock Active
          </div>
        </div>

        {/* Loading Skeletons */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="bg-slate-800/40 border border-slate-700/50 rounded-3xl p-6 space-y-4 animate-pulse">
                <div className="flex justify-between items-start">
                  <div className="h-6 w-2/3 bg-slate-700 rounded-lg"></div>
                  <div className="h-5 w-1/4 bg-slate-700 rounded-lg"></div>
                </div>
                <div className="space-y-2 pt-2">
                  <div className="h-4 w-1/2 bg-slate-700 rounded-lg"></div>
                  <div className="h-4 w-3/4 bg-slate-700 rounded-lg"></div>
                </div>
                <div className="pt-4 border-t border-slate-700/40 flex justify-between items-center">
                  <div className="h-10 w-24 bg-slate-700 rounded-xl"></div>
                  <div className="h-10 w-28 bg-slate-700 rounded-xl"></div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {inventories.length === 0 ? (
              <div className="text-center py-16 bg-slate-800/20 border border-slate-800 border-dashed rounded-3xl">
                <Package className="h-12 w-12 text-slate-500 mx-auto mb-3" />
                <p className="text-slate-400 font-medium">No inventory items found.</p>
                <p className="text-slate-500 text-sm mt-1">Make sure you have configured your DATABASE_URL and run the seed script.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {inventories.map((item) => {
                  const key = `${item.productId}_${item.warehouseId}`;
                  const currentQty = quantities[key] || 1;
                  const itemReservingId = `${item.productId}-${item.warehouseId}`;
                  const isThisReserving = reservingId === itemReservingId;
                  const isOutOfStock = item.availableStock <= 0;

                  return (
                    <div 
                      key={key} 
                      className={`relative bg-slate-800/40 border transition-all duration-300 rounded-3xl flex flex-col justify-between overflow-hidden shadow-md group ${
                        isOutOfStock 
                          ? "border-slate-800/60 opacity-80" 
                          : "border-slate-700/50 hover:border-slate-600 hover:shadow-lg hover:shadow-indigo-950/20 hover:-translate-y-0.5"
                      }`}
                    >
                      {/* Card Content */}
                      <div className="p-6 space-y-4 flex-1">
                        {/* Title & Warehouse */}
                        <div className="space-y-1.5">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="font-bold text-lg text-white group-hover:text-indigo-300 transition duration-300 leading-tight">
                              {item.productName}
                            </h3>
                            <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-700 border border-slate-600 text-slate-300">
                              SKU
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-slate-400">
                            <Building2 className="h-3.5 w-3.5 text-slate-500" />
                            <span className="font-medium text-slate-300">{item.warehouseName}</span>
                          </div>
                        </div>

                        {/* Stocks Data */}
                        <div className="grid grid-cols-3 gap-2 bg-slate-900/60 p-3 rounded-2xl border border-slate-800/50 text-center">
                          <div>
                            <div className="text-[10px] text-slate-400 font-medium">Total</div>
                            <div className="text-sm font-bold text-slate-200 mt-0.5">{item.totalStock}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-amber-400 font-medium">Reserved</div>
                            <div className="text-sm font-bold text-amber-300 mt-0.5">{item.reservedStock}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-emerald-400 font-medium font-bold">Available</div>
                            <div className={`text-sm font-black mt-0.5 ${isOutOfStock ? "text-rose-400 animate-pulse" : "text-emerald-400"}`}>
                              {item.availableStock}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Card Footer Actions */}
                      <div className="bg-slate-900/40 px-6 py-4 border-t border-slate-800/60 flex items-center justify-between gap-4 mt-auto">
                        
                        {/* Quantity Selector */}
                        <div className="flex items-center bg-slate-800 border border-slate-700 rounded-xl px-1 py-1 h-9">
                          <button
                            onClick={() => handleQuantityChange(item.productId, item.warehouseId, -1, item.availableStock)}
                            disabled={isOutOfStock || currentQty <= 1 || isThisReserving}
                            className="p-1 text-slate-400 hover:text-white disabled:text-slate-600 disabled:hover:text-slate-600 hover:bg-slate-700 rounded-lg transition"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          
                          <span className="w-8 text-center text-xs font-semibold text-slate-100">
                            {isOutOfStock ? 0 : currentQty}
                          </span>
                          
                          <button
                            onClick={() => handleQuantityChange(item.productId, item.warehouseId, 1, item.availableStock)}
                            disabled={isOutOfStock || currentQty >= item.availableStock || isThisReserving}
                            className="p-1 text-slate-400 hover:text-white disabled:text-slate-600 disabled:hover:text-slate-600 hover:bg-slate-700 rounded-lg transition"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Reserve Button */}
                        <button
                          onClick={() => handleReserve(item.productId, item.warehouseId, item.availableStock)}
                          disabled={isOutOfStock || isThisReserving}
                          className={`flex-1 flex items-center justify-center gap-1.5 h-9 px-3 rounded-xl transition text-xs font-bold shadow-md ${
                            isOutOfStock
                              ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed"
                              : "bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white shadow-indigo-600/10 hover:shadow-indigo-500/20"
                          }`}
                        >
                          {isThisReserving ? (
                            <>
                              <RefreshCw className="h-3 w-3 animate-spin" />
                              <span>Holding...</span>
                            </>
                          ) : isOutOfStock ? (
                            <span>Sold Out</span>
                          ) : (
                            <>
                              <span>Reserve</span>
                              <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition duration-300" />
                            </>
                          )}
                        </button>

                      </div>

                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-6 px-6 mt-12 bg-slate-950/20">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-slate-400">
          <p>© 2026 ALLO Health E-Commerce Take-Home exercise.</p>
          <div className="flex gap-4">
            <span className="hover:text-slate-200 transition">PostgreSQL row lock: Active</span>
            <span className="text-slate-600">|</span>
            <span className="hover:text-slate-200 transition">Next.js 16 App Router</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
