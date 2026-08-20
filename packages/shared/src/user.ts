export type Role = 'ADMIN' | 'USER';

export interface UserDto {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  mustChangePassword: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: UserDto;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface CreateUserRequest {
  username: string;
  fullName: string;
  password: string;
  role: Role;
}

export interface UpdateUserRequest {
  fullName?: string;
  role?: Role;
}
