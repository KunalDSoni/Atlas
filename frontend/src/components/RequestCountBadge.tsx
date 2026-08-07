import React from 'react';

interface RequestCountBadgeProps {
  count: number;
  merged?: boolean;
}

export const RequestCountBadge: React.FC<RequestCountBadgeProps> = ({ count, merged = false }) => {
  const bgColor = merged ? 'bg-yellow-100' : 'bg-blue-100';
  const textColor = merged ? 'text-yellow-800' : 'text-blue-800';

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${bgColor} ${textColor}`}>
      {count} request{count !== 1 ? 's' : ''}
      {merged && <span className="ml-1">📎</span>}
    </span>
  );
};
