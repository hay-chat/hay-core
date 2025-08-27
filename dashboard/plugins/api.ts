import { buildQueryString } from '~/composables/useApi';

export default defineNuxtPlugin(() => {
  const api = useApi();
  
  // Create a wrapper that can be called as a function or used as an object
  const apiWrapper = Object.assign(
    // The function signature for direct calls
    (endpoint: string, options?: any) => api.request(endpoint, options),
    // All the methods
    {
      get: api.get,
      post: api.post,
      put: api.put,
      patch: api.patch,
      delete: api.delete,
      upload: api.upload,
      request: api.request,
    }
  );
  
  return {
    provide: {
      api: apiWrapper,
      apiUtils: {
        buildQueryString,
      },
    },
  };
});