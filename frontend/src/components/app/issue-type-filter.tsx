import { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TYPE_LABEL } from '@/lib/domain';
import { TypeIcon } from '@/components/app/primitives';

interface IssueTypeFilterProps {
  selectedTypes: string[];
  onSelectedTypesChange: (types: string[]) => void;
}

export function IssueTypeFilter({ selectedTypes, onSelectedTypesChange }: IssueTypeFilterProps) {
  const allTypes = useMemo(() => Object.keys(TYPE_LABEL), []);

  const displayLabel = selectedTypes.length === 0
    ? 'All types'
    : selectedTypes.length === 1
      ? TYPE_LABEL[selectedTypes[0]]
      : `${selectedTypes.length} types selected`;

  function handleTypeToggle(type: string) {
    const updated = selectedTypes.includes(type)
      ? selectedTypes.filter((t) => t !== type)
      : [...selectedTypes, type];
    onSelectedTypesChange(updated);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          aria-label="Filter by issue type"
        >
          <span className="text-sm">{displayLabel}</span>
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel className="text-xs">Issue Type</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {allTypes.map((type) => (
          <DropdownMenuCheckboxItem
            key={type}
            checked={selectedTypes.includes(type)}
            onCheckedChange={() => handleTypeToggle(type)}
            className="gap-2"
          >
            <TypeIcon type={type} />
            <span>{TYPE_LABEL[type]}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
