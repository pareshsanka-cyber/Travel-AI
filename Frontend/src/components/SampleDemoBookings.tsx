import { BookDemoButton } from './BookDemoButton';

type Props = {
  flight?: boolean;
  hotel?: boolean;
  onBook: (kind: 'flight' | 'hotel', id: string, source?: 'discovered' | 'sample') => Promise<void>;
};
export function SampleDemoBookings({ flight, hotel, onBook }: Props) {
  if (!flight && !hotel) return null;
  return <section aria-label="Sample demo bookings" className="rounded-2xl border border-primary/25 bg-primary/5 p-5 space-y-4">
    <h3 className="font-semibold">Try sample demo bookings</h3>
    <p className="text-sm text-on-surface-variant">Clearly fictional options for testing checkout. They match your trip dates and do not replace your selections or map locations. No money charged or real reservation made.</p>
    <div className={`grid gap-4 ${flight && hotel ? 'sm:grid-cols-2' : ''}`}>
      {flight && <div className="rounded-xl bg-surface-container p-4 space-y-3"><h4 className="font-semibold">Sample demo airline · Fictional</h4><p className="text-sm">One-way · ₹5,000 per traveler</p><BookDemoButton kind="flight" source="sample" id="sample-flight" price={5000} onBook={onBook} /></div>}
      {hotel && <div className="rounded-xl bg-surface-container p-4 space-y-3"><h4 className="font-semibold">Sample demo hotel · Fictional</h4><p className="text-sm">₹2,500 per room per night</p><BookDemoButton kind="hotel" source="sample" id="sample-hotel" price={2500} onBook={onBook} /></div>}
    </div>
  </section>;
}
