/**
 * Detect a PostgreSQL unique-constraint violation (SQLSTATE 23505).
 *
 * The error code may live on the top-level error or on `err.cause`
 * because drizzle-orm wraps some PG errors when going through the
 * postgres-js adapter. This helper checks both paths so callers don't
 * have to.
 *
 * Optional `constraint` arg lets callers narrow to a specific index
 * name (e.g. `team_members_one_lead_uq`) — useful when one transaction
 * could throw 23505 from multiple indexes and only one of them
 * corresponds to the conflict the caller wants to convert to a 409.
 *
 * @example Basic usage
 * try {
 *   await tx.insert(teams).values({...});
 * } catch (err) {
 *   if (isUniqueViolation(err)) throw conflict("...");
 *   throw err;
 * }
 *
 * @example Constraint-specific matching
 * if (isUniqueViolation(err, "team_coordinations_one_published_uq")) {
 *   throw conflict("coordination already published");
 * }
 */
export function isUniqueViolation(
  err: unknown,
  constraint?: string,
): boolean {
  if (!err || typeof err !== "object") return false;
  const code =
    (err as { code?: string }).code ??
    (err as { cause?: { code?: string } }).cause?.code;
  if (code !== "23505") return false;
  if (constraint === undefined) return true;
  const cName =
    (err as { constraint?: string }).constraint ??
    (err as { cause?: { constraint?: string } }).cause?.constraint;
  return cName === constraint;
}
