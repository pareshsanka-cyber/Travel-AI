import { createContext } from 'react';

// The root owns trip state; discovery cards cannot apply a response to another trip.
export const TravelDiscoveryContext = createContext<(trip: Record<string, any>) => void>(() => {});
