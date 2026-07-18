import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';

type Source = { index: number; id: string; title: string; space_id: string };

/** "Ask your wiki" — a RAG-lite Q&A over wiki page content with citations. */
export function AskWikiDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);

  async function ask() {
    if (question.trim().length < 3) return;
    setLoading(true);
    setAnswer(null);
    try {
      const res = await api.ai.ask({ question: question.trim() });
      setAnswer(res.answer);
      setSources(res.sources);
    } catch (e) {
      toast.error('Could not get an answer', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Ask your wiki</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <Textarea
            autoFocus
            rows={2}
            placeholder="Ask anything about your documentation…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void ask(); }}
            className="resize-none"
          />
          <Button size="icon" className="shrink-0" onClick={() => void ask()} disabled={loading || question.trim().length < 3} aria-label="Ask">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>

        {loading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Searching your wiki…</p>}

        {answer && !loading && (
          <div className="max-h-[50vh] space-y-3 overflow-y-auto">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer}</p>
            {sources.length > 0 && (
              <div className="border-t border-border pt-3">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sources</p>
                <ul className="space-y-1">
                  {sources.map((s) => (
                    <li key={s.id}>
                      <Link
                        to={`/wiki/page/${s.id}`}
                        onClick={() => onOpenChange(false)}
                        className="flex items-center gap-2 text-sm text-primary hover:underline"
                      >
                        <span className="grid size-5 shrink-0 place-items-center rounded bg-primary/10 text-[11px] font-semibold">{s.index}</span>
                        <span className="truncate">{s.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">Answers are generated from your wiki pages and may be imperfect — check the sources.</p>
      </DialogContent>
    </Dialog>
  );
}
