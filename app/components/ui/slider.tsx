import * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";

import { cn } from "~/lib/utils";

function Slider({
  className,
  value,
  defaultValue,
  min = 0,
  max = 100,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const values = value ?? defaultValue ?? [min];

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50",
        className,
      )}
      value={value}
      defaultValue={defaultValue}
      min={min}
      max={max}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      {values.map((_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          className="block size-4 shrink-0 rounded-full border border-primary bg-background shadow-sm outline-none transition-shadow hover:ring-4 hover:ring-ring/30 focus-visible:ring-4 focus-visible:ring-ring/50 disabled:pointer-events-none"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
