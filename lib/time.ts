// lib/time.ts
// Unix seconds: the unit every timestamp column in the schema uses.
export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

// Resolve after `ms` milliseconds.
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
