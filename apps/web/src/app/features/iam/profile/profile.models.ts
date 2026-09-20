export type { User, UserSession, ApiToken, CreatedTokenResponse } from '../../../core/models/auth.models';

export interface PasswordForm {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface PasswordStrength {
  score: number;
  label: string;
  percent: number;
  colorClass: string;
}

export interface TokenExpirationOption {
  value: string;
  labelKey: string;
}
