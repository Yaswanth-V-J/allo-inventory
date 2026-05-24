"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { 
  Clock, 
  ShoppingBag, 
  Trash2, 
  Check, 
  Building2, 
  AlertTriangle, 
  ArrowLeft,
  Loader2,
  Calendar,
  Layers,
  Sparkles
} from "lucide-react";
import confetti from "canvas-confetti";
import { notifyInventoryUpdated } from "@/lib/inventory-events";

interface Reservation {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  status: "PENDING" | "CONFIRMED" | "RELEASED";
  expiresAt: string;
  createdAt: string;
  product: { name: string };
  warehouse: { name: string };
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ReservationPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params); // Await params in Next.js 15+

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<"confirm" | "release" | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [isExpiredLocally, setIsExpiredLocally] = useState(false);

  // Fetch the reservation details
  const fetchReservation = async () => {
    try {
      const res = await fetch(`/api/reservations/${id}`, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error("RESERVATION_NOT_FOUND");
        }
        throw new Error("Failed to load reservation details.");
      }
      const data: Reservation = await res.json();
      setReservation(data);

      // Calculate time remaining
      const expiry = new Date(data.expiresAt).getTime();
      const now = new Date().getTime();
      const diff = Math.max(0, Math.floor((expiry - now) / 1000));
      setSecondsLeft(diff);

      if (diff <= 0 && data.status === "PENDING") {
        setIsExpiredLocally(true);
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message === "RESERVATION_NOT_FOUND" 
        ? "The requested reservation does not exist." 
        : "An error occurred while loading reservation details."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReservation();
  }, [id]);

  // Countdown timer effect
  useEffect(() => {
    if (!reservation || reservation.status !== "PENDING" || secondsLeft <= 0) return;

    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setIsExpiredLocally(true);
          // Re-fetch to sync backend status (triggers lazy cleanup)
          fetchReservation();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [reservation, secondsLeft]);

  const goToProducts = () => {
    notifyInventoryUpdated();
    router.refresh();
    router.push("/");
  };

  // Format timer into MM:SS
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${remainingSecs.toString().padStart(2, "0")}`;
  };

  // Confirm reservation
  const handleConfirm = async () => {
    if (!reservation) return;
    setActionLoading("confirm");
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/reservations/${id}/confirm`, {
        method: "POST",
      });

      if (res.status === 410) {
        setErrorMsg("Reservation expired");
        setIsExpiredLocally(true);
        await fetchReservation();
        return;
      }

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Confirmation failed.");
      }

      const updatedRes: Reservation = await res.json();
      setReservation(updatedRes);
      notifyInventoryUpdated();
      router.refresh();

      // Trigger Confetti Celebration!
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 },
        colors: ["#6366f1", "#10b981", "#3b82f6"]
      });

    } catch (err: any) {
      setErrorMsg(err.message || "An unexpected error occurred during confirmation.");
    } finally {
      setActionLoading(null);
    }
  };

  // Release/Cancel reservation
  const handleRelease = async () => {
    if (!reservation) return;
    setActionLoading("release");
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/reservations/${id}/release`, {
        method: "POST",
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Cancellation failed.");
      }

      const updatedRes: Reservation = await res.json();
      setReservation(updatedRes);
      notifyInventoryUpdated();
      router.refresh();

    } catch (err: any) {
      setErrorMsg(err.message || "An unexpected error occurred during cancellation.");
    } finally {
      setActionLoading(null);
    }
  };

  // UI state derived helpers
  const isPending = reservation?.status === "PENDING" && !isExpiredLocally;
  const isConfirmed = reservation?.status === "CONFIRMED";
  const isReleased = reservation?.status === "RELEASED" || isExpiredLocally;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center font-sans gap-3">
        <Loader2 className="h-10 w-10 text-indigo-500 animate-spin" />
        <p className="text-slate-400 font-medium text-sm">Verifying reservation status...</p>
      </div>
    );
  }

  if (errorMsg && !reservation) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center font-sans p-6 text-center">
        <div className="bg-rose-950/20 border border-rose-900 p-8 rounded-3xl max-w-md space-y-4">
          <AlertTriangle className="h-12 w-12 text-rose-500 mx-auto" />
          <h2 className="text-xl font-bold text-rose-300">Checkout Error</h2>
          <p className="text-sm text-slate-300">{errorMsg}</p>
          <button
            onClick={goToProducts}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl transition text-sm font-semibold border border-slate-700/50"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Return to Stock</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <button
            onClick={goToProducts}
            className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 rounded-xl transition text-sm font-medium border border-slate-800 text-slate-300 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Products</span>
          </button>
          
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping"></span>
            <span>Live Checkout Session</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-12 flex flex-col justify-center">
        
        {/* Error Banner */}
        {errorMsg && (
          <div className="mb-6 p-4 bg-rose-950/40 border border-rose-800/80 rounded-2xl flex items-start gap-3 text-rose-200 shadow-lg shadow-rose-950/10 animate-in fade-in slide-in-from-top-4 duration-300">
            <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-rose-300">Checkout Warning</p>
              <p className="text-sm text-rose-200/90">{errorMsg}</p>
            </div>
          </div>
        )}

        <div className="bg-slate-800/40 border border-slate-700/60 rounded-3xl shadow-xl shadow-slate-950/40 overflow-hidden">
          
          {/* Top Banner Status indicator */}
          <div className={`px-6 py-4 flex items-center justify-between border-b ${
            isConfirmed 
              ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-400"
              : isReleased
              ? "bg-slate-950/30 border-slate-800/60 text-slate-400"
              : "bg-indigo-950/20 border-indigo-900/30 text-indigo-400"
          }`}>
            <span className="text-xs font-bold uppercase tracking-wider">Status Overview</span>
            <span className={`px-3 py-1 rounded-full text-xs font-extrabold border ${
              isConfirmed
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : isReleased
                ? "bg-slate-800 border-slate-700 text-slate-400"
                : "bg-indigo-500/10 border-indigo-500/30 text-indigo-400"
            }`}>
              {isConfirmed ? "CONFIRMED" : isReleased ? "RELEASED / EXPIRED" : "PENDING HOLD"}
            </span>
          </div>

          {/* Body details */}
          <div className="p-8 space-y-8">
            
            {/* Split layout: Details vs Timer */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              
              {/* Product and warehouse details */}
              <div className="space-y-4">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Item Selected</span>
                  <h2 className="text-2xl font-black text-white leading-tight">{reservation?.product.name}</h2>
                </div>
                
                <div className="space-y-3 pt-2 text-sm">
                  <div className="flex items-center gap-2 text-slate-300">
                    <Building2 className="h-4.5 w-4.5 text-indigo-400 shrink-0" />
                    <div>
                      <span className="text-slate-500 text-xs">Warehouse:</span>{" "}
                      <span className="font-semibold text-slate-200">{reservation?.warehouse.name}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-slate-300">
                    <Layers className="h-4.5 w-4.5 text-indigo-400 shrink-0" />
                    <div>
                      <span className="text-slate-500 text-xs">Quantity Reserved:</span>{" "}
                      <span className="font-extrabold text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-lg text-xs">
                        {reservation?.quantity} {reservation?.quantity === 1 ? "unit" : "units"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-slate-300">
                    <Calendar className="h-4.5 w-4.5 text-indigo-400 shrink-0" />
                    <div>
                      <span className="text-slate-500 text-xs">Reference ID:</span>{" "}
                      <span className="font-mono text-xs text-slate-400">{reservation?.id}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Countdown Circular Card */}
              <div className="flex flex-col items-center justify-center bg-slate-900/60 border border-slate-800 p-6 rounded-2xl text-center space-y-3">
                {isPending ? (
                  <>
                    <div className="flex items-center gap-1.5 text-xs text-amber-400 font-bold">
                      <Clock className="h-4 w-4 animate-pulse" />
                      <span>Stock Temporarily Blocked</span>
                    </div>
                    <div className="text-4xl font-mono font-black text-indigo-400 tracking-wider">
                      {formatTime(secondsLeft)}
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed max-w-[200px]">
                      Complete purchase before timer runs out, or inventory will be released automatically.
                    </p>
                  </>
                ) : isConfirmed ? (
                  <div className="py-4 space-y-2">
                    <div className="h-12 w-12 rounded-full bg-emerald-500/10 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto shadow-md shadow-emerald-950/20">
                      <Check className="h-6 w-6 font-bold" />
                    </div>
                    <h3 className="font-bold text-emerald-400 text-lg flex items-center gap-1 justify-center">
                      Purchase Confirmed <Sparkles className="h-4 w-4" />
                    </h3>
                    <p className="text-xs text-slate-400 max-w-[200px] mx-auto">
                      Inventory has been permanently deducted. Receipt sent.
                    </p>
                  </div>
                ) : (
                  <div className="py-4 space-y-2">
                    <div className="h-12 w-12 rounded-full bg-slate-800 border border-slate-700 text-slate-500 flex items-center justify-center mx-auto">
                      <Trash2 className="h-5 w-5" />
                    </div>
                    <h3 className="font-bold text-slate-400 text-lg">Stock Released</h3>
                    <p className="text-xs text-slate-500 max-w-[200px] mx-auto">
                      Reservation expired or canceled. Items returned to shelves.
                    </p>
                  </div>
                )}
              </div>

            </div>

            {/* Action Buttons */}
            {isPending && (
              <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row gap-4">
                {/* Confirm purchase */}
                <button
                  onClick={handleConfirm}
                  disabled={actionLoading !== null}
                  className="flex-1 h-12 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-2xl shadow-lg shadow-indigo-600/15 hover:shadow-indigo-500/25 transition duration-300 flex items-center justify-center gap-2 text-sm"
                >
                  {actionLoading === "confirm" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Confirming Payment...</span>
                    </>
                  ) : (
                    <>
                      <ShoppingBag className="h-4 w-4" />
                      <span>Confirm Purchase</span>
                    </>
                  )}
                </button>

                {/* Cancel Reservation */}
                <button
                  onClick={handleRelease}
                  disabled={actionLoading !== null}
                  className="sm:w-1/3 h-12 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 disabled:opacity-50 border border-slate-700 text-slate-300 font-semibold rounded-2xl transition duration-300 flex items-center justify-center gap-2 text-sm"
                >
                  {actionLoading === "release" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Releasing...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" />
                      <span>Cancel Reservation</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Return button if released or confirmed */}
            {!isPending && (
              <div className="pt-4 border-t border-slate-800 flex justify-center">
                <button
                  onClick={goToProducts}
                  className="px-6 h-11 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold rounded-2xl transition flex items-center gap-2 text-xs"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Return to Product Inventory</span>
                </button>
              </div>
            )}

          </div>

        </div>

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-6 px-6 mt-12 bg-slate-950/20">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-slate-400">
          <p>© 2026 ALLO Health E-Commerce Take-Home exercise.</p>
          <div className="flex gap-4">
            <span>Pg Row-Level Locks: Active</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
