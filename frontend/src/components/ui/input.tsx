import * as React from "react"

import { cn } from "@/lib/utils"

// forwardRef for the same reason textarea.tsx has it: this project runs React
// 18, where a plain function component cannot receive a ref — it arrives as
// null with no warning. That is exactly how every Radix popper in the app came
// to render off-screen (see KNOWN-ISSUES.md), because Button was missing this
// and floating-ui had no element to measure. Input is not a popper anchor
// today, but it is the last primitive still carrying the fault.
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  function Input({ className, type, ...props }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        className={cn(
          "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
          className
        )}
        {...props}
      />
    )
  }
)

export { Input }
