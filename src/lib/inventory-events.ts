export const INVENTORY_UPDATED_EVENT = "inventory-updated";

export function notifyInventoryUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(INVENTORY_UPDATED_EVENT));
  }
}

export function subscribeInventoryUpdated(handler: () => void) {
  window.addEventListener(INVENTORY_UPDATED_EVENT, handler);
  return () => window.removeEventListener(INVENTORY_UPDATED_EVENT, handler);
}
