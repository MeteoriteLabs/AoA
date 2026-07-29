/**
 * End an identity transition with a new document.
 *
 * A client-side route change would keep the old JavaScript context alive, so a
 * mutation started by the previous account could still run its callbacks after
 * the query cache is cleared. Replacing the document makes the browser itself
 * the final account-isolation boundary.
 */
export function replaceWithSignedOutPage(): void {
  window.location.replace("/auth");
}
