import React, { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

interface FormattedChatMessageProps {
  content: string;
  onActionClick?: (actionType: 'details' | 'budget' | 'dates' | 'travelers' | 'destination') => void;
  className?: string;
}

/**
 * Strips raw asterisks, backticks, or leftover markdown artifacts
 * so unparsed syntax never leaks into the rendered user interface.
 */
export function cleanStrayMarkdown(text: string): string {
  if (!text) return '';
  return text.replace(/\*{1,3}/g, '').replace(/`+/g, '');
}

/**
 * Tokenizes and renders inline markdown safely:
 * - ***bold italic*** -> <strong><em>
 * - **bold** -> <strong>
 * - *italic* or _italic_ -> <em>
 * - `code` -> <code>
 * - Strips any remaining unparsed asterisks for crystal-clear presentation.
 */
export function renderInlineContent(
  text: string,
  onActionClick?: (actionType: 'details' | 'budget' | 'dates' | 'travelers' | 'destination') => void
): ReactNode[] {
  if (!text) return [];

  const regex = /(\*\*\*([^*]+)\*\*\*)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(_([^_]+)_)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const plain = text.slice(lastIndex, match.index);
      nodes.push(cleanStrayMarkdown(plain));
    }

    if (match[1]) {
      // Bold Italic (***text***)
      nodes.push(
        <strong key={`bi-${key++}`} className="font-semibold italic text-on-surface">
          {match[2]}
        </strong>
      );
    } else if (match[3]) {
      // Bold (**text**)
      nodes.push(
        <strong key={`b-${key++}`} className="font-semibold text-on-surface">
          {match[4]}
        </strong>
      );
    } else if (match[5]) {
      // Italic (*text*)
      nodes.push(
        <em key={`i-${key++}`} className="italic text-on-surface-variant font-medium">
          {match[6]}
        </em>
      );
    } else if (match[7]) {
      // Inline code (`text`)
      nodes.push(
        <code
          key={`c-${key++}`}
          className="px-1.5 py-0.5 rounded bg-surface-container-highest/60 text-xs font-mono text-primary font-medium"
        >
          {match[8]}
        </code>
      );
    } else if (match[9]) {
      // Underscore italic (_text_)
      nodes.push(
        <em key={`u-${key++}`} className="italic text-on-surface-variant font-medium">
          {match[10]}
        </em>
      );
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    const plain = text.slice(lastIndex);
    nodes.push(cleanStrayMarkdown(plain));
  }

  return nodes;
}

/**
 * FormattedChatMessage renders rich Markdown from the AI assistant
 * without raw stars/asterisks, turning constraint prompts into
 * beautiful modern card widgets with direct action triggers.
 */
export const FormattedChatMessage: React.FC<FormattedChatMessageProps> = ({
  content,
  onActionClick,
  className = '',
}) => {
  if (!content) return null;

  const rawLines = content.split('\n');
  const elements: ReactNode[] = [];
  let currentParagraphLines: string[] = [];
  let currentListItems: string[] = [];

  const flushParagraph = () => {
    if (currentParagraphLines.length > 0) {
      const text = currentParagraphLines.join(' ').trim();
      if (text) {
        elements.push(
          <p key={`p-${elements.length}`} className="text-sm leading-relaxed text-on-surface">
            {renderInlineContent(text, onActionClick)}
          </p>
        );
      }
      currentParagraphLines = [];
    }
  };

  const flushList = () => {
    if (currentListItems.length > 0) {
      elements.push(
        <div key={`list-${elements.length}`} className="space-y-2 py-1">
          {currentListItems.map((item, idx) => {
            // Check for emoji + title pattern e.g.: - 💰 **Budget**: Estimated total budget...
            const emojiPattern = /^([\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}])\s*(.*)$/u;
            const emojiMatch = item.match(emojiPattern);

            if (emojiMatch) {
              const emoji = emojiMatch[1];
              const rest = emojiMatch[2];
              const titleMatch = rest.match(/^\*\*([^*]+)\*\*:\s*(.*)$/);

              if (titleMatch) {
                const title = titleMatch[1];
                const detail = titleMatch[2];

                // Detect action button target
                let actionType: 'budget' | 'dates' | 'travelers' | 'destination' | 'details' = 'details';
                let actionLabel: string = 'Configure';

                if (/set budget/i.test(detail) || /budget/i.test(title)) {
                  actionType = 'budget';
                  actionLabel = 'Set Budget';
                } else if (/select dates/i.test(detail) || /when/i.test(title) || /date/i.test(title)) {
                  actionType = 'dates';
                  actionLabel = 'Select Dates';
                } else if (/add travelers/i.test(detail) || /traveler/i.test(title)) {
                  actionType = 'travelers';
                  actionLabel = 'Add Travelers';
                } else if (/where/i.test(title) || /destination/i.test(title)) {
                  actionType = 'destination';
                  actionLabel = 'Destination';
                }

                // Clean the detail text from awkward instructional phrasing
                const cleanedDetail = detail
                  .replace(/\s*or click \*\*[^*]+\*\* above/gi, '')
                  .replace(/\s*\(or click \*\*[^*]+\*\* above\)/gi, '')
                  .trim();

                return (
                  <div
                    key={`card-${idx}`}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-container/70 border border-surface-container-highest/60 shadow-xs hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-base shrink-0 select-none">
                        {emoji}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-on-surface uppercase tracking-wider">
                          {title}
                        </div>
                        <div className="text-xs text-on-surface-variant leading-relaxed">
                          {renderInlineContent(cleanedDetail, onActionClick)}
                        </div>
                      </div>
                    </div>

                    {onActionClick && (
                      <button
                        type="button"
                        onClick={() => onActionClick(actionType)}
                        className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/10 hover:bg-primary text-primary hover:text-on-primary border border-primary/20 transition-all cursor-pointer shadow-xs active:scale-95"
                      >
                        <span>{actionLabel}</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              }
            }

            // Standard bullet point
            return (
              <div
                key={`bullet-${idx}`}
                className="flex items-start gap-2 text-xs sm:text-sm text-on-surface leading-relaxed"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-primary/80 mt-2 shrink-0" />
                <div className="min-w-0 flex-1">
                  {renderInlineContent(item, onActionClick)}
                </div>
              </div>
            );
          })}
        </div>
      );
      currentListItems = [];
    }
  };

  for (const line of rawLines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    // List item (starts with -, *, or •)
    const listMatch = trimmed.match(/^[-*•]\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      currentListItems.push(listMatch[1]);
      continue;
    }

    // Heading (starts with ### or ## or #)
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      elements.push(
        <h4
          key={`h-${elements.length}`}
          className="font-bold text-xs uppercase tracking-wider text-primary mt-3 mb-1"
        >
          {cleanStrayMarkdown(headingMatch[2])}
        </h4>
      );
      continue;
    }

    // Regular line in paragraph
    flushList();
    currentParagraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();

  return (
    <div className={`space-y-2.5 ${className}`}>
      {elements}
    </div>
  );
};
