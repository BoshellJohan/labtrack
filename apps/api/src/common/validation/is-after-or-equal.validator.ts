import {
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';

@ValidatorConstraint({ name: 'isAfterOrEqual', async: false })
class IsAfterOrEqualConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const [sinceProperty] = args.constraints as [string];
    const since = (args.object as Record<string, unknown>)[sinceProperty];

    if (value === undefined || value === null) return true;
    if (since === undefined || since === null) return true;
    if (typeof value !== 'string' || typeof since !== 'string') return false;

    const untilDate = new Date(value);
    const sinceDate = new Date(since);
    if (
      Number.isNaN(untilDate.getTime()) ||
      Number.isNaN(sinceDate.getTime())
    ) {
      // Not this validator's job: @IsDateString already rejects malformed
      // dates. Pass here so that error surfaces instead of this one.
      return true;
    }

    return untilDate.getTime() >= sinceDate.getTime();
  }

  defaultMessage(args: ValidationArguments): string {
    const [sinceProperty] = args.constraints as [string];
    return `${args.property} must not be earlier than ${sinceProperty}`;
  }
}

/**
 * Asserts that the annotated date-string property is not earlier than a
 * named sibling property (equal is accepted, since "everything on this exact
 * day/instant" is a legitimate range). Passes when either bound is absent —
 * pairing with `@IsOptional()` on both properties is expected, and malformed
 * dates are left to `@IsDateString()` to reject.
 */
export function IsAfterOrEqual(
  sinceProperty: string,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [sinceProperty],
      validator: IsAfterOrEqualConstraint,
    });
  };
}
