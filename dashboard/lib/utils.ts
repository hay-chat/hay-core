import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validatePassword(password: string): {
  isValid: boolean;
  strength: 'weak' | 'medium' | 'strong';
  requirements: {
    length: boolean;
    uppercase: boolean;
    lowercase: boolean;
    number: boolean;
    special: boolean;
  };
} {
  const requirements = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[!@#$%^&*(),.?":{}|<>]/.test(password),
  };

  const metRequirements = Object.values(requirements).filter(Boolean).length;
  const isValid = metRequirements >= 4 && requirements.length;

  let strength: 'weak' | 'medium' | 'strong';
  if (metRequirements <= 2) {
    strength = 'weak';
  } else if (metRequirements <= 4) {
    strength = 'medium';
  } else {
    strength = 'strong';
  }

  return { isValid, strength, requirements };
}
