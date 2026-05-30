export async function withTiming<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = performance.now() - start;
    console.log(`⏱️  [${label}] ${duration.toFixed(0)}ms`);
    return result;
  } catch (err) {
    const duration = performance.now() - start;
    console.error(`❌ [${label}] ${duration.toFixed(0)}ms — error`);
    throw err;
  }
}
