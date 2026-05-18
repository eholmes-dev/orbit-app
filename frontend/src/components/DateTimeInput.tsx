import { useState } from "react";
import { CalendarIcon, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface DateTimeInputProps {
  /** Value in "YYYY-MM-DDTHH:mm" local-time format (same as <input type="datetime-local">). */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

// Year-dropdown bounds for the date picker's caption dropdowns. Computed
// once at module load.
const PICKER_START_MONTH = new Date(new Date().getFullYear() - 5, 0);
const PICKER_END_MONTH = new Date(new Date().getFullYear() + 10, 11);

/** 15-minute time slots, "HH:mm" + locale-formatted label. Generated once. */
const TIME_OPTIONS: { value: string; label: string }[] = (() => {
  const opts: { value: string; label: string }[] = [];
  const fmt = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const d = new Date();
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      d.setHours(h, m, 0, 0);
      opts.push({ value, label: fmt.format(d) });
    }
  }
  return opts;
})();

function toLocalString(d: Date): string {
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

function humanDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function DateTimeInput({ value, onChange, disabled }: DateTimeInputProps) {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(value) : undefined;
  const time = value ? value.slice(11, 16) : "";

  const setDate = (d: Date | undefined) => {
    if (!d) {
      onChange("");
      setOpen(false);
      return;
    }
    // Preserve existing time if there is one, otherwise default to 09:00.
    const [h, m] = (time || "09:00").split(":").map(Number);
    const next = new Date(d);
    next.setHours(h, m, 0, 0);
    onChange(toLocalString(next));
    setOpen(false);
  };

  const setTime = (t: string) => {
    if (!t) return;
    const [h, m] = t.split(":").map(Number);
    // If no date yet, anchor to today so the user gets a usable value.
    const base = date ?? new Date();
    base.setHours(h, m, 0, 0);
    onChange(toLocalString(base));
  };

  return (
    <div className="flex flex-col gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-start font-normal",
              !date && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="size-4 mr-2" />
            {date ? humanDate(date) : "Pick a date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={setDate}
            captionLayout="dropdown"
            startMonth={PICKER_START_MONTH}
            endMonth={PICKER_END_MONTH}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      <Select
        value={time || undefined}
        onValueChange={setTime}
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
          <Clock className="size-4 mr-1 opacity-60" />
          <SelectValue placeholder="Pick a time" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {TIME_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
