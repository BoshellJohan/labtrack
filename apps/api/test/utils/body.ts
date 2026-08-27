import { Response } from 'supertest';

// supertest types `body` as `any`, which makes every assertion an unsafe member
// access. This names the shape at the call site instead.
export function body<T>(response: Response): T {
  return response.body as T;
}
