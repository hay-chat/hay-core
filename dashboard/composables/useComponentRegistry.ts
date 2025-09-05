// Global registry for component instances
const componentRegistry = new Map<string, any>();

export const useComponentRegistry = () => {
  const registerComponent = (id: string, instance: any) => {
    componentRegistry.set(id, instance);
  };

  const unregisterComponent = (id: string) => {
    componentRegistry.delete(id);
  };

  const getComponent = (id: string) => {
    return componentRegistry.get(id);
  };

  return {
    registerComponent,
    unregisterComponent,
    getComponent,
    componentRegistry
  };
};