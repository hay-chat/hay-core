export type FormFieldType =
  | "text"
  | "email"
  | "phone"
  | "number"
  | "date"
  | "select"
  | "checkbox"
  | "textarea";

export type CustomerFieldMapping = "name" | "email" | "phone";

export interface FormFieldOption {
  value: string;
  label: string;
}

export interface FormFieldValidation {
  pattern?: string;
  min?: number;
  max?: number;
}

export interface FormField {
  name: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  placeholder?: string;
  options?: FormFieldOption[];
  validation?: FormFieldValidation;
  mapToCustomer?: CustomerFieldMapping;
}

export interface FormSchema {
  id: string;
  title?: string;
  description?: string;
  submitLabel?: string;
  fields: FormField[];
}

export type FormResponse = Record<string, string | number | boolean | null>;

export type FormStatus = "PENDING" | "SUBMITTED" | "SKIPPED";

export interface FormMessageMetadata {
  ui: {
    kind: "form";
    schema: FormSchema;
    status: FormStatus;
    response?: FormResponse;
    submittedAt?: string;
  };
}
