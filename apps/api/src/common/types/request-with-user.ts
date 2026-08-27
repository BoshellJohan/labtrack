import { Request } from 'express';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

// Express types `request.user` as `any`. Naming the shape here once keeps the
// unsafe access out of every guard and decorator that reads it.
export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}
