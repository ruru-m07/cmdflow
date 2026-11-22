import { cn } from "@/lib/utils";

const colors = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--info",
  "--info-foreground",
  "--success",
  "--success-foreground",
  "--warning",
  "--warning-foreground",
  "--border",
  "--input",
  "--ring",
  "--canvas",
  "--panel",
  "--panel-raised",
  "--border-strong",
  "--danger",
  "--danger-foreground",
  "--focus",
  "--code-highlight",
  "--code",
  "--chart-5",
  "--chart-4",
  "--chart-3",
  "--chart-2",
  "--chart-1",
];

const ColorPage = () => {
  return (
    <div className="grid grid-cols-8 justify-self-start">
      {colors.map((color) => (
        <div
          className={cn("size-30")}
          key={color}
          style={{ backgroundColor: `var(${color})` }}
        >
          <span className="text-xs text-red-500">{color}</span>
        </div>
      ))}
    </div>
  );
};

export default ColorPage;
