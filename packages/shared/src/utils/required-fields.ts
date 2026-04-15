/**
 * Required-field evaluation helper for `DataFieldDefinition.required_if`.
 *
 * Used by both the widget's GET endpoint (to decide which question to
 * ask next) and the widget's POST endpoint (to decide whether a service
 * has finished collecting all of its required data and can be promoted
 * to `ready_to_deliver`). Centralised here so the two routes can never
 * disagree about which fields are required given the current answers.
 *
 * The `equals_empty: true` clause is the most common case: a field that
 * only matters if a sibling field is unanswered. Example: the
 * website-build service asks for `tagline` only when the client has no
 * `existing_website` to import from. Without this helper, the widget
 * either asks for tagline unconditionally (annoying for clients who
 * have a site we'll scrape) or never asks (broken for clients who
 * don't).
 */

import type { DataFieldDefinition, RequiredIfClause } from "../types";

/** Treat null/undefined/whitespace-only strings as "empty" for matching. */
function isEmpty(value: string | undefined | null): boolean {
  return !value || value.trim() === "";
}

/**
 * Evaluate a `required_if` clause against the current set of answers
 * for a single client_service. Returns `true` if the clause matches and
 * the parent field should be treated as required.
 *
 * `answers` should be a map of `field_key -> field_value` scoped to the
 * SAME client_service whose required-fields are being evaluated.
 * Cross-service answer lookup is intentionally not supported because
 * services are evaluated independently for `ready_to_deliver`
 * promotion.
 */
export function evaluateRequiredIf(
  clause: RequiredIfClause,
  answers: Record<string, string | undefined>
): boolean {
  const siblingValue = answers[clause.field];

  if (clause.equals_empty) {
    if (isEmpty(siblingValue)) return true;
    // The "N/A" / "none" sentinels that clients commonly type when they
    // have nothing to enter are treated as empty so the dependent
    // fields still kick in. This is intentional UX: if a client types
    // "n/a" for `existing_website`, we should still ask for the tagline
    // and address that we'd otherwise pull from the site.
    const trimmed = siblingValue?.trim().toLowerCase();
    if (
      trimmed === "n/a" ||
      trimmed === "na" ||
      trimmed === "none" ||
      trimmed === "no"
    ) {
      return true;
    }
  }

  if (clause.equals !== undefined) {
    if ((siblingValue?.trim() ?? "") === clause.equals.trim()) return true;
  }

  if (clause.equals_one_of && clause.equals_one_of.length > 0) {
    const normalized = (siblingValue?.trim() ?? "").toLowerCase();
    if (
      clause.equals_one_of
        .map((v) => v.trim().toLowerCase())
        .includes(normalized)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Decide whether a single field should be treated as required given
 * the current answers for its client_service. Combines the static
 * `required: true` flag with the dynamic `required_if` clause.
 *
 * - Always required if `field.required === true`.
 * - Conditionally required if `field.required_if` is present and its
 *   clause matches the current answers.
 * - Otherwise optional (the widget skips it entirely).
 */
export function isFieldRequired(
  field: DataFieldDefinition,
  answers: Record<string, string | undefined>
): boolean {
  if (field.required) return true;
  if (field.required_if) {
    return evaluateRequiredIf(field.required_if, answers);
  }
  return false;
}

/**
 * Filter a service definition's `required_data_fields` list down to
 * the fields that are currently required given the answers on file.
 * Use this in place of `.filter(f => f.required)` everywhere the widget
 * needs to know which fields still need an answer.
 */
export function filterCurrentlyRequiredFields(
  fields: DataFieldDefinition[],
  answers: Record<string, string | undefined>
): DataFieldDefinition[] {
  return fields.filter((f) => isFieldRequired(f, answers));
}
