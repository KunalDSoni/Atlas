import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { ArticleSuggestion } from '@/lib/types';

/**
 * Help articles offered while a customer describes their problem.
 *
 * Two rules shape this component:
 *  - It NEVER blocks submission. Fetches are debounced, failures are swallowed,
 *    and nothing here can disable the send button. Deflection is an offer.
 *  - Opening a suggestion logs a hit, and "this solved it" logs `helped` —
 *    which is what turns deflection into a measured number instead of a claim.
 */

const DEBOUNCE_MS = 300;

export function ArticleSuggestions({ requestTypeId, query, onDeflected }: {
  requestTypeId: string;
  query: string;
  /** Called when the customer says an article solved it, so the draft can close. */
  onDeflected: () => void;
}) {
  const [items, setItems] = useState<ArticleSuggestion[]>([]);
  // The request in flight, so a slow response for an old query cannot overwrite
  // a fast one for the current query.
  const latest = useRef(0);

  useEffect(() => {
    if (!requestTypeId) return undefined;
    const seq = ++latest.current;
    const timer = setTimeout(() => {
      api.help.suggestions(requestTypeId, query)
        .then((res) => { if (seq === latest.current) setItems(res); })
        .catch(() => { /* suggestions are an offer; never surface a failure here */ });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [requestTypeId, query]);

  if (items.length === 0) return null;

  function open(article: ArticleSuggestion) {
    void api.help.logArticleHit({ page_id: article.id, request_type_id: requestTypeId }).catch(() => {});
    window.open(`/wiki/page/${article.id}`, '_blank', 'noopener');
  }

  function solved(article: ArticleSuggestion) {
    void api.help.logArticleHit({
      page_id: article.id, request_type_id: requestTypeId, helped: true,
    }).catch(() => {});
    onDeflected();
  }

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <BookOpen className="size-3.5" />
        These might answer your question
      </p>
      <ul className="space-y-2">
        {items.map((a) => (
          <li key={a.id} className="rounded-md bg-background p-2">
            <button
              type="button"
              onClick={() => open(a)}
              className="text-left text-sm font-medium text-primary hover:underline"
            >
              {a.title}
            </button>
            {a.excerpt && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.excerpt}</p>}
            <Button variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs" onClick={() => solved(a)}>
              <Check className="size-3" /> This solved my problem
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
