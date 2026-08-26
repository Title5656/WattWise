import * as React from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return <input type={type} data-slot="input" className={cn('h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base outline-none transition-colors focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 md:text-sm', className)} {...props} />;
}

export { Input };
