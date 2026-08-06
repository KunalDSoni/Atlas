import React, { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { ProjectMember } from '@/lib/types';

interface MentionAutocompleteProps {
  projectId: string;
  authorId: string;
  children: React.ReactNode; // the textarea/input element
  onMentionInsert: (mentionText: string) => void;
}

interface DropdownState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  filteredMembers: ProjectMember[];
}

/**
 * MentionAutocomplete wraps a textarea/input element and provides @mention autocomplete functionality.
 * It detects when the user types '@', shows a dropdown with project members, and inserts mentions on selection.
 */
export function MentionAutocomplete({
  projectId,
  authorId,
  children,
  onMentionInsert,
}: MentionAutocompleteProps) {
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [dropdown, setDropdown] = useState<DropdownState>({
    isOpen: false,
    query: '',
    selectedIndex: 0,
    filteredMembers: [],
  });
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch project members on mount
  useEffect(() => {
    async function fetchMembers() {
      try {
        const projectMembers = await api.projects.members(projectId);
        // Filter out the author (self-mentions excluded)
        const filteredMembers = projectMembers.filter((m) => m.id !== authorId);
        setMembers(filteredMembers);
      } catch (error) {
        console.error('Failed to fetch project members:', error);
      }
    }
    fetchMembers();
  }, [projectId, authorId]);

  // Handle input changes to detect @ and filter members
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const input = e.currentTarget;
    const cursorPos = input.selectionStart || 0;
    const text = input.value;

    // Find the last @ before cursor
    let atIndex = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      if (text[i] === '@') {
        atIndex = i;
        break;
      }
      // Stop if we hit a space or newline (mention doesn't span across these)
      if (text[i] === ' ' || text[i] === '\n') {
        break;
      }
    }

    if (atIndex >= 0) {
      // We have an active mention
      const query = text.substring(atIndex + 1, cursorPos).toLowerCase();
      const filtered = members.filter((m) =>
        m.name.toLowerCase().includes(query)
      );
      setMentionStart(atIndex);
      setDropdown({
        isOpen: filtered.length > 0,
        query,
        selectedIndex: 0,
        filteredMembers: filtered,
      });
    } else {
      // No active mention
      setMentionStart(null);
      setDropdown({
        isOpen: false,
        query: '',
        selectedIndex: 0,
        filteredMembers: [],
      });
    }
  };

  // Handle key events for navigation and selection
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (!dropdown.isOpen) return;

    switch (e.key) {
      case 'ArrowUp': {
        e.preventDefault();
        setDropdown((prev) => ({
          ...prev,
          selectedIndex: Math.max(0, prev.selectedIndex - 1),
        }));
        break;
      }
      case 'ArrowDown': {
        e.preventDefault();
        setDropdown((prev) => ({
          ...prev,
          selectedIndex: Math.min(prev.filteredMembers.length - 1, prev.selectedIndex + 1),
        }));
        break;
      }
      case 'Enter': {
        e.preventDefault();
        insertMention(dropdown.filteredMembers[dropdown.selectedIndex]);
        break;
      }
      case 'Escape': {
        e.preventDefault();
        setDropdown((prev) => ({ ...prev, isOpen: false }));
        setMentionStart(null);
        break;
      }
    }
  };

  // Insert a mention at the current cursor position
  const insertMention = (member: ProjectMember) => {
    if (!inputRef.current || mentionStart === null) return;

    const input = inputRef.current;
    const cursorPos = input.selectionStart || 0;
    const text = input.value;

    // Find the actual end of the query (up to cursor)
    const query = text.substring(mentionStart + 1, cursorPos);
    const mentionText = `@${member.name}`;

    // Replace @query with @Full Name
    const before = text.substring(0, mentionStart);
    const after = text.substring(cursorPos);
    const newText = before + mentionText + after;

    input.value = newText;

    // Update cursor position to after the inserted mention
    const newCursorPos = mentionStart + mentionText.length;
    input.setSelectionRange(newCursorPos, newCursorPos);

    // Trigger input event for parent to track changes
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Call the callback
    onMentionInsert(mentionText);

    // Close dropdown
    setDropdown((prev) => ({ ...prev, isOpen: false }));
    setMentionStart(null);
  };

  // Handle click on a member in the dropdown
  const handleMemberClick = (member: ProjectMember) => {
    insertMention(member);
  };

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setDropdown((prev) => ({ ...prev, isOpen: false }));
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Clone the children to attach our event handlers and ref
  const clonedChildren = children && typeof children === 'object' && 'type' in children
    ? React.cloneElement(children as React.ReactElement<any>, {
        ref: (el: HTMLTextAreaElement | HTMLInputElement | null) => {
          inputRef.current = el;
          // Call the original ref if it exists
          if (typeof (children as any).ref === 'function') {
            (children as any).ref(el);
          }
        },
        onInput: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
          handleInput(e);
          ((children as any).props?.onInput)?.(e);
        },
        onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
          handleKeyDown(e);
          ((children as any).props?.onKeyDown)?.(e);
        },
      })
    : children;

  // Calculate dropdown position based on input and mention start
  const getDropdownPosition = () => {
    if (!inputRef.current || mentionStart === null) return { top: 0, left: 0 };

    const input = inputRef.current;
    const rect = input.getBoundingClientRect();
    const scrollTop = input.scrollTop || 0;

    // For now, position directly below the input
    // A more sophisticated implementation could calculate the exact line
    return {
      top: rect.bottom - scrollTop,
      left: rect.left,
    };
  };

  const { top, left } = getDropdownPosition();

  return (
    <div className="mention-autocomplete-wrapper">
      {clonedChildren}
      {dropdown.isOpen && dropdown.filteredMembers.length > 0 && (
        <div
          ref={dropdownRef}
          className="mention-autocomplete-dropdown"
          style={{
            top: `${top}px`,
            left: `${left}px`,
            width: `${inputRef.current?.offsetWidth || 'auto'}px`,
          }}
        >
          {dropdown.filteredMembers.map((member, index) => (
            <div
              key={member.id}
              className={`mention-item ${index === dropdown.selectedIndex ? 'selected' : ''}`}
              onClick={() => handleMemberClick(member)}
              role="option"
              aria-selected={index === dropdown.selectedIndex}
            >
              <div className="flex items-center gap-2">
                <div
                  className="h-6 w-6 rounded-full flex-shrink-0"
                  style={{ backgroundColor: member.avatar_color }}
                  title={member.name}
                />
                <span className="text-sm">{member.name}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
