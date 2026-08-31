import {
  ValidationOptions,
  registerDecorator,
  ValidationArguments,
} from 'class-validator';

const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;

// Characters that render as a hyphen but are not one: the non-breaking hyphen,
// the figure dash, the en and em dashes, the minus sign, and the fullwidth
// hyphen. Copying a CAS number out of a catalogue, a PDF or a web page brings
// one of these along regularly.
const HYPHEN_LOOKALIKES = /[‐‑‒–—―−－]/g;

/**
 * Cleans a pasted CAS number into its canonical form.
 *
 * A user who pastes `67–64–1` sees a value indistinguishable from a correct
 * one and is told the format is invalid, which reads as the system being
 * wrong — and it is. Mapping the lookalikes is deterministic, not a guess: a
 * CAS number has exactly one valid separator, so there is no second reading
 * to lose. That is what separates this from a decimal comma, where `2,5`
 * could legitimately mean two different numbers and is therefore rejected
 * rather than interpreted.
 *
 * Normalising is also what gets stored: keeping an en dash in the column would
 * leave the reagent unfindable by its own CAS number.
 */
export function normalizeCasNumber(value: string): string {
  return value.trim().replace(HYPHEN_LOOKALIKES, '-');
}

/**
 * A CAS registry number carries its own checksum: reading the digits before
 * the final one from right to left, each is multiplied by its 1-based
 * position, and the sum modulo 10 must equal that final digit.
 *
 * The shape alone accepts `12345-67-9`, which is not a CAS number — it just
 * looks like one. That distinction does not matter much when someone types a
 * reagent by hand; it matters when hundreds arrive from a spreadsheet.
 */
export function isValidCasNumber(value: string): boolean {
  const normalized = normalizeCasNumber(value);

  if (!CAS_SHAPE.test(normalized)) {
    return false;
  }

  const digits = normalized.replace(/-/g, '');
  const checkDigit = Number(digits.slice(-1));
  const sum = digits
    .slice(0, -1)
    .split('')
    .reverse()
    .reduce((total, digit, index) => total + Number(digit) * (index + 1), 0);

  return sum % 10 === checkDigit;
}

export function IsCasNumber(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isCasNumber',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && isValidCasNumber(value),
        // The two failure modes need different messages: "this is not shaped
        // like a CAS number" and "the shape is right but the check digit does
        // not match" send a user to look in completely different places.
        defaultMessage: (args: ValidationArguments) => {
          const value = args.value as unknown;
          if (
            typeof value === 'string' &&
            CAS_SHAPE.test(normalizeCasNumber(value))
          ) {
            return `${args.property} is shaped like a CAS number but its check digit does not match`;
          }
          return `${args.property} must be a CAS number, e.g. 67-64-1`;
        },
      },
    });
  };
}
