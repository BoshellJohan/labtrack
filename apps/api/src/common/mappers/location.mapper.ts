import { LocationDto } from '@labtrack/shared';
import { Location } from '../../prisma/client';

export function toLocationDto(location: Location): LocationDto {
  return {
    id: location.id,
    name: location.name,
    description: location.description,
    active: location.active,
    createdAt: location.createdAt.toISOString(),
    updatedAt: location.updatedAt.toISOString(),
  };
}
