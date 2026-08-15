import React from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RequestCountBadge } from './RequestCountBadge';

interface MergeFeatureSummary {
  id: string;
  name: string;
  request_count: number;
}

interface MergeConfirmDialogProps {
  parentFeature: MergeFeatureSummary;
  childFeatures: MergeFeatureSummary[];
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export const MergeConfirmDialog: React.FC<MergeConfirmDialogProps> = ({
  parentFeature,
  childFeatures,
  onConfirm,
  onCancel,
  isLoading = false,
}) => {
  const [reason, setReason] = React.useState('');
  const totalRequests =
    parentFeature.request_count + childFeatures.reduce((sum, f) => sum + f.request_count, 0);

  return (
    <Dialog open onOpenChange={open => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm merge</DialogTitle>
          <DialogDescription>
            Requests from the merged features move to the one you keep. You can undo this for 24 hours.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Keep this feature</Label>
            <div className="rounded-lg border bg-muted/50 p-3">
              <div className="font-medium">{parentFeature.name}</div>
              <RequestCountBadge count={parentFeature.request_count} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Merge these features</Label>
            <div className="space-y-2">
              {childFeatures.map(feature => (
                <div key={feature.id} className="rounded-lg border bg-warning-muted p-3 text-warning-foreground">
                  <div className="font-medium">{feature.name}</div>
                  <RequestCountBadge count={feature.request_count} merged />
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border bg-primary-muted p-3 text-sm font-medium text-accent-foreground">
            Combined requests: <RequestCountBadge count={totalRequests} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="merge-reason">Reason (optional)</Label>
            <Textarea
              id="merge-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Why are these the same request?"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(reason.trim() || undefined)} disabled={isLoading}>
            {isLoading ? 'Merging…' : `Merge ${childFeatures.length} feature${childFeatures.length !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
