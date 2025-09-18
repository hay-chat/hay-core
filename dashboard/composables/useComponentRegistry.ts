// Component instance interface for rich input components
interface ComponentInstance {
  insertReference?: (type: string, item: Record<string, unknown>) => void;
  [key: string]: unknown;
}

// Global registry for component instances
const componentRegistry = new Map<string, ComponentInstance>();

export const useComponentRegistry = () => {
  const registerComponent = (id: string, instance: ComponentInstance) => {
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
    componentRegistry,
  };
};
