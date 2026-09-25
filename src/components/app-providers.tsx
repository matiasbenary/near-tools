'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NearProvider } from 'near-connect-hooks';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { DefaultNetwork, NetworkId, RpcUrls } from '@/config';

const networkStorageKey = 'near-stake-network';

const NetworkContext = createContext<{
  network: NetworkId;
  setNetwork: (network: NetworkId) => void;
} | null>(null);

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (!context) throw new Error('useNetwork must be used inside AppProviders');
  return context;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [network, setNetworkState] = useState<NetworkId>(DefaultNetwork);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      })
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(networkStorageKey);
    if (stored === 'mainnet' || stored === 'testnet') setNetworkState(stored);
  }, []);

  const setNetwork = (nextNetwork: NetworkId) => {
    window.localStorage.setItem(networkStorageKey, nextNetwork);
    setNetworkState(nextNetwork);
  };

  return (
    <NetworkContext.Provider value={{ network, setNetwork }}>
      <QueryClientProvider client={queryClient}>
        <NearProvider key={network} config={{ network, providers: RpcUrls }}>
          {children}
        </NearProvider>
      </QueryClientProvider>
    </NetworkContext.Provider>
  );
}
