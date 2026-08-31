import {
  ValidationOptions,
  registerDecorator,
  ValidationArguments,
} from 'class-validator';

const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;

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
  if (!CAS_SHAPE.test(value)) {
    return false;
  }

  const digits = value.replace(/-/g, '');
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
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be a valid CAS number, e.g. 67-64-1`,
      },
    });
  };
}
