// Drain active work before returning an error so that a retry cannot overlap an old upload.
export async function mapLimited(items, task, concurrency = 3) {
 const results = new Array(items.length);
 let next = 0, failure;
 async function worker() {
  while (next < items.length && !failure) {
   const index = next++;
   try { results[index] = await task(items[index], index); }
   catch (error) { failure ||= error; }
  }
 }
 await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, worker));
 if (failure) throw failure;
 return results;
}
