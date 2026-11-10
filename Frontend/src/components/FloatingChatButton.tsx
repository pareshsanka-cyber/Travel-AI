import React, { useState } from 'react';
import { Bot } from 'lucide-react';

interface FloatingChatButtonProps {
  onClick: () => void;
  isOpen?: boolean;
}

export const FloatingChatButton: React.FC<FloatingChatButtonProps> = ({
  onClick,
  isOpen = false,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  if (isOpen) return null;

  return (
    <div className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] right-[calc(1.5rem+env(safe-area-inset-right,0px))] z-40 sm:bottom-8 sm:right-8">
      {/* Tooltip on hover / keyboard focus */}
      <div
        id="floating-chat-tooltip"
        role="tooltip"
        className={`pointer-events-none absolute bottom-full mb-2.5 right-0 whitespace-nowrap px-3 py-1.5 rounded-xl bg-surface-container-highest/95 backdrop-blur-md text-on-surface text-xs font-semibold shadow-xl border border-surface-container-highest/60 transition-all duration-150 ${
          isHovered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
        }`}
      >
        Ask TravelAI
      </div>

      <button
        type="button"
        aria-label="Open TravelAI Assistant"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-describedby="floating-chat-tooltip"
        title="Ask TravelAI"
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => setIsHovered(true)}
        onBlur={() => setIsHovered(false)}
        className="w-14 h-14 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-xl shadow-primary/25 hover:shadow-2xl hover:shadow-primary/40 hover:scale-105 active:scale-95 transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface cursor-pointer"
      >
        <Bot className="w-7 h-7 text-on-primary transition-transform duration-200" />
      </button>
    </div>
  );
};
