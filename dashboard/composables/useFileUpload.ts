import { ref } from "vue";

export interface UseFileUploadOptions {
  accept?: string;
  maxSizeMB?: number;
}

export function useFileUpload(options?: UseFileUploadOptions) {
  const fileInput = ref<File | null>(null);
  const preview = ref<string | null>(null);
  const error = ref<string | null>(null);
  const isUploading = ref(false);

  function selectFile(event: Event) {
    error.value = null;
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];

    if (!file) return;

    // Validate size
    if (options?.maxSizeMB && file.size > options.maxSizeMB * 1024 * 1024) {
      error.value = `File too large (max ${options.maxSizeMB}MB)`;
      fileInput.value = null;
      preview.value = null;
      return;
    }

    fileInput.value = file;

    // Generate preview (base64 data URI)
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.value = e.target?.result as string;
    };
    reader.onerror = () => {
      error.value = "Failed to read file";
      fileInput.value = null;
      preview.value = null;
    };
    reader.readAsDataURL(file);
  }

  async function getBase64(): Promise<string | null> {
    return preview.value;
  }

  function reset() {
    fileInput.value = null;
    preview.value = null;
    error.value = null;
    isUploading.value = false;
  }

  return {
    fileInput,
    preview,
    error,
    isUploading,
    selectFile,
    getBase64,
    reset,
  };
}
