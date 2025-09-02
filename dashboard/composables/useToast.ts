import { ref } from 'vue'

export interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message?: string
  duration?: number
}

const toasts = ref<Toast[]>([])
const toastTimeouts = new Map<string, NodeJS.Timeout>()

export function useToast() {
  const show = (toast: Omit<Toast, 'id'>): string => {
    const id = Date.now().toString()
    const newToast = { ...toast, id }
    toasts.value.push(newToast)
    
    if (toast.duration !== 0) {
      const timeout = setTimeout(() => {
        remove(id)
      }, toast.duration || 5000)
      toastTimeouts.set(id, timeout)
    }
    
    return id
  }
  
  const update = (id: string, title: string, message?: string) => {
    const toast = toasts.value.find(t => t.id === id)
    if (toast) {
      toast.title = title
      if (message !== undefined) {
        toast.message = message
      }
    }
  }
  
  const remove = (id: string) => {
    const index = toasts.value.findIndex(t => t.id === id)
    if (index > -1) {
      toasts.value.splice(index, 1)
    }
    
    // Clear timeout if exists
    const timeout = toastTimeouts.get(id)
    if (timeout) {
      clearTimeout(timeout)
      toastTimeouts.delete(id)
    }
  }
  
  const success = (title: string, message?: string, duration?: number): string => {
    return show({ type: 'success', title, message, duration })
  }
  
  const error = (title: string, message?: string, duration?: number): string => {
    return show({ type: 'error', title, message, duration })
  }
  
  const warning = (title: string, message?: string, duration?: number): string => {
    return show({ type: 'warning', title, message, duration })
  }
  
  const info = (title: string, message?: string, duration?: number): string => {
    return show({ type: 'info', title, message, duration })
  }
  
  return {
    toasts,
    show,
    update,
    remove,
    success,
    error,
    warning,
    info,
    toast: {
      success,
      error,
      warning,
      info
    }
  }
}