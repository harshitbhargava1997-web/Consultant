// Opt in only for reads and submissions whose stable IDs make a lost response safe to retry.
export async function requestJson(send, {attempts = 3, wait = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
 for (let attempt = 1; attempt <= attempts; attempt++) {
  let response;
  try {
   response = await send();
   let data;
   try { data = await response.json(); }
   catch {
    if (response.ok || response.status >= 500) throw new TypeError('The server response was interrupted.');
    throw Object.assign(Error('The request could not be completed. Please try again.'), {status: response.status});
   }
   if (response.ok) return data;
   throw Object.assign(Error(data.error || 'The request could not be completed. Please try again.'), {status: response.status, fileId: data.fileId});
  } catch (error) {
   const transient = error instanceof TypeError || error.status >= 500 || [408, 429].includes(error.status);
   if (!transient || attempt === attempts) {
    if (error instanceof TypeError) throw Error('Connection interrupted. Your submission may already be saved. Retry to check and complete the same submission.');
    throw error;
   }
   await wait(400 * attempt);
  }
 }
}
