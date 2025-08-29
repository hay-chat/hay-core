import { ref } from 'vue';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

const toasts = ref<Toast[]>([]);

export const useToast = () => {
  const show = (message: string, type: Toast['type'] = 'info', duration = 3000) => {
    const id = Date.now().toString();
    const toast: Toast = { id, message, type, duration };
    
    toasts.value.push(toast);
    
    if (duration > 0) {
      setTimeout(() => {
        remove(id);
      }, duration);
    }
    
    return id;
  };
  
  const update = (id: string, message: string, type?: Toast['type']) => {
    const toast = toasts.value.find(t => t.id === id);
    if (toast) {
      toast.message = message;
      if (type) {
        toast.type = type;
      }
    }
  };
  
  const remove = (id: string) => {
    const index = toasts.value.findIndex(t => t.id === id);
    if (index > -1) {
      toasts.value.splice(index, 1);
    }
  };
  
  const success = (message: string, duration?: number) => {
    return show(message, 'success', duration);
  };
  
  const error = (message: string, duration?: number) => {
    return show(message, 'error', duration);
  };
  
  const info = (message: string, duration?: number) => {
    return show(message, 'info', duration);
  };
  
  const warning = (message: string, duration?: number) => {
    return show(message, 'warning', duration);
  };
  
  const toast = (type: Toast['type'], message: string, duration?: number) => {
    return show(message, type, duration);
  };
  
  return {
    toasts: readonly(toasts),
    show,
    update,
    remove,
    success,
    error,
    info,
    warning,
    toast,
  };
};