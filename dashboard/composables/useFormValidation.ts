import { validateEmail, validatePassword } from "@/lib/utils";

export interface ValidationRule {
  required?: boolean;
  email?: boolean;
  minLength?: number;
  maxLength?: number;
  password?: boolean;
  match?: string;
  custom?: (_value: string) => string | null;
}

export interface ValidationRules {
  [key: string]: ValidationRule;
}

export function useFormValidation<T extends Record<string, unknown>>(
  form: T,
  rules: ValidationRules,
) {
  const errors = reactive<Record<string, string>>({});
  const touched = reactive<Record<string, boolean>>({});

  // Initialize errors
  Object.keys(rules).forEach((key) => {
    errors[key] = "";
    touched[key] = false;
  });

  const validateField = (field: keyof T): boolean => {
    const value = form[field] as string;
    const rule = rules[field as string];

    if (!rule) return true;

    touched[field as string] = true;

    // Required validation
    if (rule.required && (!value || value.toString().trim() === "")) {
      errors[field as string] = `${String(field)} is required`;
      return false;
    }

    // Skip other validations if field is empty and not required
    if (!value && !rule.required) {
      errors[field as string] = "";
      return true;
    }

    // Email validation
    if (rule.email && !validateEmail(value)) {
      errors[field as string] = "Please enter a valid email address";
      return false;
    }

    // Min length validation
    if (rule.minLength && value.length < rule.minLength) {
      errors[field as string] = `Must be at least ${rule.minLength} characters`;
      return false;
    }

    // Max length validation
    if (rule.maxLength && value.length > rule.maxLength) {
      errors[field as string] = `Must be no more than ${rule.maxLength} characters`;
      return false;
    }

    // Password validation
    if (rule.password) {
      const passwordValidation = validatePassword(value);
      if (!passwordValidation.isValid) {
        errors[field as string] = "Password does not meet requirements";
        return false;
      }
    }

    // Match validation (for confirm password)
    if (rule.match && value !== form[rule.match as keyof T]) {
      errors[field as string] = "Values do not match";
      return false;
    }

    // Custom validation
    if (rule.custom) {
      const customError = rule.custom(value);
      if (customError) {
        errors[field as string] = customError;
        return false;
      }
    }

    // Clear error if all validations pass
    errors[field as string] = "";
    return true;
  };

  const validateAll = (): boolean => {
    let isValid = true;

    Object.keys(rules).forEach((field) => {
      const fieldValid = validateField(field as keyof T);
      if (!fieldValid) {
        isValid = false;
      }
    });

    return isValid;
  };

  const isFormValid = computed(() => {
    // Check if all required fields are filled and have no errors
    return Object.keys(rules).every((field) => {
      const rule = rules[field];
      const value = form[field as keyof T];
      const hasError = errors[field];

      // If field is required, it must have a value
      if (rule && rule.required && (!value || value.toString().trim() === "")) {
        return false;
      }

      // No errors allowed
      return !hasError;
    });
  });

  const hasAnyError = computed(() => {
    return Object.values(errors).some((error) => error !== "");
  });

  const clearErrors = () => {
    Object.keys(errors).forEach((key) => {
      errors[key] = "";
      touched[key] = false;
    });
  };

  const clearError = (field: keyof T) => {
    errors[field as string] = "";
  };

  return {
    errors: readonly(errors),
    touched: readonly(touched),
    validateField,
    validateAll,
    isFormValid,
    hasAnyError,
    clearErrors,
    clearError,
  };
}

// TODO: Add more complex validation rules as needed
// TODO: Add async validation support for server-side checks
// TODO: Add debounced validation for better UX
// TODO: Add field dependencies (validate field A when field B changes)
// TODO: Add internationalization support for error messages
