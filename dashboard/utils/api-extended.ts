// Extended API client that includes plugin routers
// This wraps the base Hay client and adds type definitions for dynamically loaded plugin routers

import { Hay as BaseHay } from "./api";

// Type definitions for cloud plugin
interface CloudBillingRouter {
  getSubscription: {
    query: () => Promise<{
      id: string;
      status: string;
      plan?: string;
      currentPeriodEnd?: Date;
      cancelAtPeriodEnd?: boolean;
    } | null>;
  };
  getPlans: {
    query: () => Promise<Array<{
      id: string;
      name: string;
      description: string;
      price: number;
      currency: string;
      interval: 'month' | 'year';
      features: any;
      popular?: boolean;
    }>>;
  };
  createCheckoutSession: {
    mutate: (params: {
      planId: string;
      successUrl: string;
      cancelUrl: string;
    }) => Promise<{ url?: string }>;
  };
  createPortalSession: {
    mutate: (params: { returnUrl: string }) => Promise<{ url?: string }>;
  };
  cancelSubscription: {
    mutate: () => Promise<any>;
  };
  reactivateSubscription: {
    mutate: () => Promise<any>;
  };
  getInvoices: {
    query: (params: { limit: number }) => Promise<Array<{
      id: string;
      number: string;
      description: string;
      date: Date | string;
      amount: number;
      currency: string;
      status: string;
    }>>;
  };
  getUsage: {
    query: () => Promise<{
      conversations: { used: number; limit: number };
      documents: { used: number; limit: number };
      storage: { used: number; limit: number };
      apiCalls: { used: number; limit: number };
      agents: { used: number; limit: number };
    }>;
  };
  updatePaymentMethod: {
    mutate: (params: { returnUrl: string }) => Promise<{ url?: string }>;
  };
}

// Cast the base Hay client to include cloud router
export const Hay = BaseHay as typeof BaseHay & {
  cloud: {
    billing: CloudBillingRouter;
  };
};