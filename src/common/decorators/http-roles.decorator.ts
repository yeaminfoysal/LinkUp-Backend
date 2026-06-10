import { SetMetadata } from '@nestjs/common';
import { HTTP_ROLES_KEY } from '../guards/http-roles.guard';

export const HttpRoles = (...roles: string[]) =>
  SetMetadata(HTTP_ROLES_KEY, roles);
