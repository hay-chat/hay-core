import { useToast } from '~/composables/useToast'

export default defineNuxtPlugin(() => {
  const toast = useToast()
  
  return {
    provide: {
      toast
    }
  }
})